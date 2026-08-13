/**
 * Polls system metrics and hands the result to a callback that pushes it to
 * the renderer(s).
 *
 * `systeminformation` looked like the obvious choice for all of this, but
 * measured on this machine: **every single poll of `currentLoad()` + `mem()`
 * + `networkStats()` together spawned dozens of `powershell.exe`/`cmd.exe`
 * child processes** (verified by watching `Win32_Process` for children of the
 * Electron process while ticking once a second). Its Windows backend shells
 * out to PowerShell/WMIC/`nvidia-smi` for network, temperature, disk and GPU
 * stats -- doing that every second, forever, is exactly the kind of
 * sustained multi-core load that made the app "barely usable". Throttling it
 * to once every 30s (an earlier fix) made the values stale, which isn't
 * acceptable for an ambient hardware display either.
 *
 * The actual fix: read every value from the same in-process OS APIs that
 * Task Manager itself uses, with zero subprocess involved, so it can run
 * every second for real:
 * - **CPU load, memory**: `os.cpus()` time-deltas / `os.totalmem()` /
 *   `os.freemem()` -- built into Node, no process involved.
 * - **Disk usage**: `fs.promises.statfs()` -- built into Node since 18.15,
 *   wraps `GetDiskFreeSpaceExW` directly via libuv.
 * - **Network throughput**: `pdh.dll` (Performance Data Helper) via Koffi
 *   FFI -- see native-metrics.ts.
 * - **GPU load/temp/VRAM**: `nvml.dll` (NVIDIA only) via Koffi FFI -- same
 *   file. Gracefully absent on non-NVIDIA machines.
 *
 * **CPU temperature has no subprocess-free path on Windows** without a
 * kernel driver -- that one field stays empty unless LibreHardwareMonitor is
 * configured (`hardwareMonitorUrl`), which is already supported below.
 */
import fs from 'node:fs/promises';
import os from 'node:os';

import { toMetricDescriptors } from '@shared/lhm-parse';
import type { AppConfig, DiskInfo, MetricDescriptor, MetricsSnapshot } from '@shared/types';

import { fetchLhmSensors } from './lhm';
import { openGpuMonitor, openNetworkMonitor, type GpuMonitor, type NetworkMonitor } from './native-metrics';

const POLL_MS = 1000;

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// -- CPU load, no subprocess --------------------------------------------------

let lastCpuTimes: os.CpuInfo['times'][] | null = null;

/** Overall load % since the previous call, or null on the very first call. */
function sampleCpuLoad(): number | null {
  const cpus = os.cpus();
  const now = cpus.map((c) => c.times);
  if (!lastCpuTimes) {
    lastCpuTimes = now;
    return null;
  }
  let idle = 0;
  let total = 0;
  for (let i = 0; i < now.length; i++) {
    const cur = now[i];
    const prev = lastCpuTimes[i];
    const idleDelta = cur.idle - prev.idle;
    const totalDelta = idleDelta + (cur.user - prev.user) + (cur.nice - prev.nice) + (cur.sys - prev.sys) + (cur.irq - prev.irq);
    idle += idleDelta;
    total += totalDelta;
  }
  lastCpuTimes = now;
  return total > 0 ? round1(100 * (1 - idle / total)) : null;
}

// -- Disk usage, no subprocess -------------------------------------------------

/** Probes A:..Z: via `fs.statfs` (a cheap syscall, not a subprocess) -- the only way to enumerate drive letters Node offers directly. */
async function discoverDrives(): Promise<DiskInfo[]> {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  const results = await Promise.all(
    letters.map(async (letter) => {
      try {
        const s = await fs.statfs(`${letter}:/`);
        return { letter, totalGb: round1((s.blocks * s.bsize) / 1e9) };
      } catch {
        return null;
      }
    }),
  );
  return results.filter((d): d is DiskInfo => d !== null);
}

/** Cached at `startMetrics()` -- a drive plugged in afterwards needs a restart to appear as a metric, which is an acceptable trade-off for not re-probing 26 letters every tick. */
let driveLetters: string[] = [];

async function sampleDisks(): Promise<Record<string, number>> {
  const values: Record<string, number> = {};
  await Promise.all(
    driveLetters.map(async (letter) => {
      try {
        const s = await fs.statfs(`${letter}:/`);
        const total = s.blocks * s.bsize;
        const free = s.bfree * s.bsize;
        const used = total - free;
        values[`disk.${letter}.usedGb`] = round1(used / 1e9);
        values[`disk.${letter}.totalGb`] = round1(total / 1e9);
        values[`disk.${letter}.usedPercent`] = round1((used / total) * 100);
      } catch {
        // Drive removed (USB stick unplugged, ...) since the last tick -- just omit it this round.
      }
    }),
  );
  return values;
}

function pollOsMetrics(): Record<string, number> {
  const values: Record<string, number> = {};

  const load = sampleCpuLoad();
  if (load !== null) values['cpu.load'] = load;

  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;
  values['mem.usedGb'] = round1(used / 1e9);
  values['mem.totalGb'] = round1(total / 1e9);
  values['mem.usedPercent'] = round1((used / total) * 100);

  return values;
}

let timer: ReturnType<typeof setInterval> | null = null;
let netMonitor: NetworkMonitor | null = null;
let gpuMonitor: GpuMonitor | null = null;

function reopenNetworkMonitor(): void {
  try {
    netMonitor?.close();
  } catch {
    // The handle is exactly what went bad; closing it is best-effort.
  }
  netMonitor = openNetworkMonitor();
}

function reopenGpuMonitor(): void {
  try {
    gpuMonitor?.close();
  } catch {
    // as above
  }
  gpuMonitor = openGpuMonitor();
}

/**
 * Read one native monitor, surviving a handle that has gone stale.
 *
 * Neither a PDH query handle nor an NVML device handle reliably survives a
 * suspend/resume cycle, and `read()` throws when its handle is dead. Without
 * this the exception would escape the whole tick, so a single broken counter
 * would take down the entire snapshot -- including the CPU/RAM/disk values,
 * which are perfectly fine -- and every dashboard would sit frozen until the
 * app was restarted. Reopening costs one failed sample; if it cannot be
 * reopened the monitor stays null and is simply skipped from then on.
 */
function readNative<T>(monitor: { read(): T | null } | null, reopen: () => void, label: string): T | null {
  if (!monitor) return null;
  try {
    return monitor.read();
  } catch (err) {
    console.warn(`[metrics] ${label} read failed, reopening: ${err instanceof Error ? err.message : String(err)}`);
    reopen();
    return null;
  }
}

/** Called after the machine wakes, before anything has had a chance to read a dead handle. */
export function reopenNativeMonitors(): void {
  reopenNetworkMonitor();
  reopenGpuMonitor();
}

export function startMetrics(getConfig: () => AppConfig, onTick: (snapshot: MetricsSnapshot) => void): void {
  if (timer) return;

  netMonitor = openNetworkMonitor();
  gpuMonitor = openGpuMonitor();
  void discoverDrives().then((disks) => {
    driveLetters = disks.map((d) => d.letter);
  });

  /** A round that overruns its own 1s interval must not pile up another. */
  let busy = false;

  const tick = async (): Promise<void> => {
    if (busy) return;
    const cfg = getConfig();
    // Nothing can be displaying a metric if no dashboard exists yet -- skip
    // the work entirely rather than reading values nobody sees.
    if (cfg.dashboards.length === 0) return;

    busy = true;
    try {
      await runTick(cfg);
    } catch (err) {
      // One bad sample must not kill the polling loop -- without this the
      // rejection escapes as an unhandled promise and every dashboard stops
      // updating for good.
      console.warn(`[metrics] tick failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      busy = false;
    }
  };

  const runTick = async (cfg: AppConfig): Promise<void> => {
    const values = pollOsMetrics();

    Object.assign(values, await sampleDisks());

    const net = readNative(netMonitor, reopenNetworkMonitor, 'network');
    if (net) {
      values['net.rxKbps'] = net.rxKbps;
      values['net.txKbps'] = net.txKbps;
    }

    const gpu = readNative(gpuMonitor, reopenGpuMonitor, 'gpu');
    if (gpu) {
      values['gpu.load'] = gpu.load;
      values['gpu.temp'] = gpu.temp;
      values['gpu.memUsedPercent'] = gpu.memUsedPercent;
    }

    if (cfg.hardwareMonitorUrl) {
      try {
        for (const sensor of await fetchLhmSensors(cfg.hardwareMonitorUrl)) {
          values[`lhm:${sensor.id}`] = sensor.value;
        }
      } catch {
        // Not configured yet, or LHM isn't running right now -- the rest of
        // the snapshot still arrives, and the UI already explains this is optional.
      }
    }

    onTick({ at: Date.now(), values });
  };
  timer = setInterval(() => void tick(), POLL_MS);
  void tick(); // don't make the first dashboard wait a full second for data
}

export function stopMetrics(): void {
  if (timer) clearInterval(timer);
  timer = null;
  netMonitor?.close();
  netMonitor = null;
  gpuMonitor?.close();
  gpuMonitor = null;
  driveLetters = [];
}

export async function listHardwareSensors(url: string | null): Promise<MetricDescriptor[]> {
  if (!url) return [];
  return toMetricDescriptors(await fetchLhmSensors(url));
}

/** For the dashboard editor's disk-metric dropdown -- a fresh probe, independent of the polling loop's cache. */
export async function listDisks(): Promise<DiskInfo[]> {
  return discoverDrives();
}
