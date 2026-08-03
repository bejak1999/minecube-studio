/**
 * Metrics that need no extra software, read directly from OS APIs in the
 * main process (see main/metrics.ts and main/native-metrics.ts). Sensors
 * from an optional LibreHardwareMonitor instance are fetched at runtime (see
 * main/lhm.ts) and merged with this list wherever the properties panel
 * offers a metric dropdown.
 *
 * `cpu.temp` is deliberately absent: Windows has no subprocess-free way to
 * read CPU temperature without a kernel driver, so nothing ever populates it
 * without LibreHardwareMonitor configured -- listing it here would just be a
 * dropdown entry that always shows "–". `gpu.temp`/`gpu.load`/
 * `gpu.memUsedPercent` *are* populated automatically on NVIDIA GPUs via
 * NVML; other GPU vendors have the same "–" problem CPU temperature does.
 *
 * Disk metrics are not static: which drives exist is only known at runtime
 * (see `diskMetrics`, fed by `main/metrics.ts`'s `listDisks` via
 * `studio.disks`).
 */
import type { DiskInfo, MetricDescriptor } from './types';

export const BUILTIN_METRICS: MetricDescriptor[] = [
  { key: 'cpu.load', label: 'metric.cpu.load', unit: '%', source: 'builtin' },
  { key: 'mem.usedPercent', label: 'metric.mem.usedPercent', unit: '%', source: 'builtin' },
  { key: 'mem.usedGb', label: 'metric.mem.usedGb', unit: 'GB', source: 'builtin' },
  { key: 'mem.totalGb', label: 'metric.mem.totalGb', unit: 'GB', source: 'builtin' },
  { key: 'net.rxKbps', label: 'metric.net.rxKbps', unit: 'KB/s', source: 'builtin' },
  { key: 'net.txKbps', label: 'metric.net.txKbps', unit: 'KB/s', source: 'builtin' },
  { key: 'gpu.load', label: 'metric.gpu.load', unit: '%', source: 'builtin' },
  { key: 'gpu.temp', label: 'metric.gpu.temp', unit: '°C', source: 'builtin' },
  { key: 'gpu.memUsedPercent', label: 'metric.gpu.memUsedPercent', unit: '%', source: 'builtin' },
];

/** Per-drive descriptors, generated from the drives `main/metrics.ts` actually found. */
export function diskMetrics(disks: DiskInfo[]): MetricDescriptor[] {
  return disks.flatMap((d) => [
    { key: `disk.${d.letter}.usedPercent`, label: `metric.disk.usedPercent:${d.letter}`, unit: '%', source: 'builtin' as const },
    { key: `disk.${d.letter}.usedGb`, label: `metric.disk.usedGb:${d.letter}`, unit: 'GB', source: 'builtin' as const },
    { key: `disk.${d.letter}.totalGb`, label: `metric.disk.totalGb:${d.letter}`, unit: 'GB', source: 'builtin' as const },
  ]);
}

export function metricUnit(key: string | undefined, catalog: MetricDescriptor[] = BUILTIN_METRICS): string {
  if (!key) return '';
  return catalog.find((m) => m.key === key)?.unit ?? '';
}

/**
 * Render a value for display.
 *
 * `format` may contain `{v}` (the rounded value) and `{u}` (the unit); without
 * one, the default is `"{v} {u}"` (or just the value if there is no unit).
 */
export function formatMetric(
  value: number | undefined,
  unit: string,
  decimals: number,
  format?: string,
): string {
  if (value === undefined || Number.isNaN(value)) return '–';
  const rounded = decimals > 0 ? value.toFixed(decimals) : String(Math.round(value));
  if (format) return format.replace('{v}', rounded).replace('{u}', unit);
  return unit ? `${rounded} ${unit}` : rounded;
}

// ---------------------------------------------------------------------------
// display-unit conversion
// ---------------------------------------------------------------------------

export interface UnitOption {
  key: string;
  label: string;
  /** Multiply the raw (stored) value by this to get the displayed value. */
  factor: number;
}

/** KB/s is the stored unit; offer the common alternates for a bandwidth readout. */
const NETWORK_UNITS: UnitOption[] = [
  { key: 'KBps', label: 'KB/s', factor: 1 },
  { key: 'MBps', label: 'MB/s', factor: 1 / 1024 },
  { key: 'Mbps', label: 'Mbit/s', factor: 8 / 1024 },
  { key: 'Gbps', label: 'Gbit/s', factor: 8 / 1024 / 1024 },
];

/** GB is the stored unit for every `*.usedGb` / `*.totalGb` metric (RAM and disk alike). */
const SIZE_UNITS: UnitOption[] = [
  { key: 'GB', label: 'GB', factor: 1 },
  { key: 'TB', label: 'TB', factor: 1 / 1000 },
];

const SIZE_KEY = /\.(usedGb|totalGb)$/;

/** Alternate display units for a metric, or null if it only has its one natural unit (e.g. a percentage). */
export function getUnitOptions(key: string | undefined): UnitOption[] | null {
  if (!key) return null;
  if (key === 'net.rxKbps' || key === 'net.txKbps') return NETWORK_UNITS;
  if (SIZE_KEY.test(key)) return SIZE_UNITS;
  return null;
}

/** Converts a raw stored value to the widget's chosen display unit, falling back to the metric's natural unit. */
export function applyUnit(
  key: string | undefined,
  rawValue: number | undefined,
  unitKey: string | undefined,
  catalog: MetricDescriptor[] = BUILTIN_METRICS,
): { value: number | undefined; unit: string } {
  const options = getUnitOptions(key);
  if (!options) return { value: rawValue, unit: metricUnit(key, catalog) };
  const chosen = options.find((o) => o.key === unitKey) ?? options[0];
  return { value: rawValue === undefined ? undefined : rawValue * chosen.factor, unit: chosen.label };
}
