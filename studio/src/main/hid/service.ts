/**
 * HID service -- runs as an Electron utilityProcess.
 *
 * Every hidapi read and write is a blocking syscall, and a single frame set is
 * ~200 reports. Doing that on the main thread would stall the UI, so all panel
 * traffic lives here. Frames arrive straight from the renderer over a
 * MessagePort; only control traffic goes through the main process.
 */
import type { HidRequest, HidResponse, HidStats, PanelStatus } from '@shared/types';
import { PING_SERIAL } from '@shared/types';

import { discoverPanels, Panel } from '../protocol/panel';

const panels = new Map<string, Panel>();

/** Newest frame awaiting a write, one per panel -- older ones are dropped. */
const pending = new Map<string, Uint8Array>();
let drainScheduled = false;

function statusOf(panel: Panel): PanelStatus {
  return {
    serial: panel.serial,
    product: panel.product,
    port: panel.port,
    path: panel.path,
    connected: panel.isOpen,
    info: panel.info,
    error: panel.lastError,
  };
}

/** Enumerate USB and fold the result into the panel map, keeping open handles. */
function refresh(): PanelStatus[] {
  const seen = new Set<string>();
  for (const desc of discoverPanels()) {
    seen.add(desc.serial);
    if (!panels.has(desc.serial)) {
      // Worth recording: this is the moment a panel that had fallen off the
      // bus comes back, which dates the recovery in the log.
      console.log(`enumerated ${desc.port} (${desc.serial})`);
      panels.set(desc.serial, new Panel(desc));
    }
  }
  for (const [serial, panel] of panels) {
    if (seen.has(serial)) continue;
    // And this is the moment it disappears -- the single most useful line in
    // the log when the panels freeze and Windows reports an unknown device.
    console.error(`${panel.port} (${serial}) VANISHED from USB enumeration`);
    panel.close(); // unplugged
    panels.delete(serial);
    lastWriteAt.delete(serial);
  }
  return [...panels.values()].map(statusOf);
}

/**
 * When each panel was last written to, so the keepalive below knows which ones
 * have gone quiet -- and so the log can show how long a panel had been idle
 * before it died, which is what tells us whether idle suspend is the cause.
 */
const lastWriteAt = new Map<string, number>();

/**
 * Windows suspends a USB device that has seen no traffic, and this hardware
 * does not reliably come back from it. Well under the default idle timeout.
 */
const KEEPALIVE_MS = 15000;

function runKeepAlive(): void {
  const now = Date.now();
  for (const [serial, panel] of panels) {
    if (!panel.isOpen) {
      // Second safety net alongside drain(): a panel showing static content
      // produces no frames at all, so without this a closed one would never
      // even be noticed, let alone reopened.
      ensureOpenThrottled(serial);
      continue;
    }
    const idleMs = now - (lastWriteAt.get(serial) ?? 0);
    if (idleMs < KEEPALIVE_MS) continue;
    try {
      panel.keepAlive();
      lastWriteAt.set(serial, Date.now());
    } catch (err) {
      panel.lastError = err instanceof Error ? err.message : String(err);
      console.error(`${panel.port}: keepalive failed after ${Math.round(idleMs / 1000)}s idle: ${panel.lastError}`);
      reconnectThrottled(serial);
    }
  }
}

/**
 * Rebuild one panel's handle from a fresh USB enumeration.
 *
 * A suspend/resume cycle re-enumerates the USB tree, which leaves the open
 * hidapi handle dead: every subsequent write throws, the panel keeps showing
 * its last frame forever, and only a restart brought it back. Reopening the
 * stored path is not enough either -- the path itself can change across
 * re-enumeration -- so the Panel object is dropped and rebuilt from a current
 * descriptor.
 */
function reconnect(serial: string): Panel | null {
  const port = panels.get(serial)?.port ?? serial;
  panels.get(serial)?.close();
  panels.delete(serial);

  const desc = discoverPanels().find((d) => d.serial === serial);
  if (!desc) return null; // genuinely gone (unplugged); discover() picks it up if it returns

  const panel = new Panel(desc);
  panels.set(serial, panel);
  try {
    panel.connect();
    console.log(`${port}: reconnected`);
    return panel;
  } catch (err) {
    panel.lastError = err instanceof Error ? err.message : String(err);
    panel.close();
    return null;
  }
}

/** A USB enumeration is not free, so a panel that stays broken is not retried on every frame. */
const RECONNECT_COOLDOWN_MS = 2000;
const lastReconnectAt = new Map<string, number>();

function reconnectThrottled(serial: string): Panel | null {
  const now = Date.now();
  if (now - (lastReconnectAt.get(serial) ?? 0) < RECONNECT_COOLDOWN_MS) return null;
  lastReconnectAt.set(serial, now);
  return reconnect(serial);
}

/** Open and handshake one panel, recording the failure rather than throwing. */
function openPanel(serial: string, panel: Panel): boolean {
  try {
    panel.connect();
    lastWriteAt.set(serial, Date.now());
    console.log(`${panel.port}: connected`);
    return true;
  } catch (err) {
    panel.lastError = err instanceof Error ? err.message : String(err);
    panel.close();
    console.error(`${panel.port}: connect failed: ${panel.lastError}`);
    return false;
  }
}

/**
 * Get a panel that is sitting closed back online.
 *
 * A closed panel used to be a dead end: drain() skipped it and the keepalive
 * ignored it, so nothing ever opened it again and it stayed black until the
 * app was restarted. That is reachable in normal use -- a reconnect that races
 * the USB tree coming back after sleep leaves exactly this state.
 *
 * Tries the handle it already has first, since that is cheap, and only falls
 * back to a full rebuild if the device came back under a different path.
 */
function ensureOpenThrottled(serial: string): Panel | null {
  const now = Date.now();
  if (now - (lastReconnectAt.get(serial) ?? 0) < RECONNECT_COOLDOWN_MS) return null;
  lastReconnectAt.set(serial, now);

  const existing = panels.get(serial);
  if (existing && !existing.isOpen && openPanel(serial, existing)) return existing;
  return reconnect(serial);
}

/** Open everything that is currently closed -- used after a bulk reconnect. */
function openAllClosed(): void {
  for (const [serial, panel] of panels) {
    if (!panel.isOpen) openPanel(serial, panel);
  }
}

function drain(): void {
  drainScheduled = false;
  // One frame per panel per pass, so a slow panel cannot starve the others.
  for (const [serial, jpeg] of [...pending]) {
    pending.delete(serial);
    const panel = panels.get(serial);
    if (!panel) {
      console.warn(`frame for unknown panel ${serial}`);
      continue;
    }
    if (!panel.isOpen) {
      // Not a dead end any more: this is where a panel left closed by a
      // reconnect that raced the USB tree used to stay black forever.
      console.warn(`frame for closed panel ${panel.port} -- reopening`);
      ensureOpenThrottled(serial);
      continue;
    }
    try {
      const chunks = panel.sendJpeg(jpeg);
      if (panel.framesSent === 1) {
        console.log(`${panel.port}: first frame written, ${jpeg.length} bytes in ${chunks} chunks`);
      }
      lastWriteAt.set(serial, Date.now());
      panel.lastError = null;
    } catch (err) {
      panel.lastError = err instanceof Error ? err.message : String(err);
      // The idle gap is the interesting part: a write that fails after a long
      // quiet spell points at the device having been suspended, one that fails
      // mid-stream points at something else entirely.
      const idleMs = Date.now() - (lastWriteAt.get(serial) ?? Date.now());
      console.error(
        `${panel.port}: write failed after ${Math.round(idleMs / 1000)}s idle ` +
          `(${panel.framesSent} frames, ${panel.writes} reports written): ${panel.lastError}`,
      );
      // Most likely a handle that went stale while the machine slept. Rebuild
      // it and push this same frame again, so a panel showing static content
      // recovers now rather than whenever its content next happens to change.
      const fresh = reconnectThrottled(serial);
      if (fresh) {
        try {
          fresh.sendJpeg(jpeg);
          fresh.lastError = null;
        } catch (retryErr) {
          fresh.lastError = retryErr instanceof Error ? retryErr.message : String(retryErr);
        }
      }
    }
  }
  if (pending.size > 0) scheduleDrain();
}

function scheduleDrain(): void {
  if (drainScheduled) return;
  drainScheduled = true;
  setImmediate(drain);
}

function collectStats(): HidStats {
  const stats: HidStats = { writes: {}, framesSent: {}, lastError: {} };
  for (const [serial, panel] of panels) {
    stats.writes[serial] = panel.writes;
    stats.framesSent[serial] = panel.framesSent;
    stats.lastError[serial] = panel.lastError;
  }
  return stats;
}

function handle(req: HidRequest): HidResponse {
  switch (req.type) {
    case 'discover':
      return { type: 'panels', panels: refresh() };

    case 'connect': {
      refresh();
      for (const serial of req.serials) {
        const panel = panels.get(serial);
        if (!panel) continue;
        try {
          panel.connect();
        } catch (err) {
          panel.lastError = err instanceof Error ? err.message : String(err);
          panel.close();
        }
      }
      return { type: 'panels', panels: [...panels.values()].map(statusOf) };
    }

    case 'disconnect': {
      for (const serial of req.serials) panels.get(serial)?.close();
      return { type: 'panels', panels: [...panels.values()].map(statusOf) };
    }

    case 'reconnect': {
      // Snapshot first: reconnect() replaces entries in `panels` as it goes.
      // Bypass the write-failure cooldown -- this was asked for explicitly.
      for (const serial of [...panels.keys()]) {
        lastReconnectAt.delete(serial);
        reconnect(serial);
      }
      // Catch panels that were unplugged (or renamed) while the machine slept.
      refresh();
      // refresh() builds Panel objects for whatever it finds but never opens
      // them, and reconnect() leaves nothing behind for a device the USB tree
      // had not produced yet. After waking, the four panels come back over
      // several seconds, so some of them reliably land in one of those states
      // -- and a closed panel is never written to, which is how three of them
      // ended up black while the one that happened to enumerate in time
      // carried on working.
      openAllClosed();
      return { type: 'panels', panels: [...panels.values()].map(statusOf) };
    }

    case 'realtime': {
      const panel = panels.get(req.serial);
      if (panel?.isOpen) {
        try {
          panel.setRealtime(req.enable);
        } catch (err) {
          panel.lastError = err instanceof Error ? err.message : String(err);
        }
      }
      return { type: 'panels', panels: [...panels.values()].map(statusOf) };
    }

    case 'stats':
      return { type: 'stats', stats: collectStats() };
  }
}

/**
 * Coerce whatever the transferred payload arrives as into bytes.
 *
 * A structured-clone transfer crosses a realm boundary, so `instanceof
 * ArrayBuffer` is not dependable here -- duck-type instead.
 */
function toBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  // last resort: something ArrayBuffer-shaped from another realm
  const maybe = value as { byteLength?: unknown } | null;
  if (maybe && typeof maybe.byteLength === 'number') {
    try {
      return new Uint8Array(value as ArrayBuffer);
    } catch {
      return null;
    }
  }
  return null;
}

let warnedAboutPayload = false;

/** Frames come in on a port handed over by the main process at startup. */
function attachFramePort(port: Electron.MessagePortMain): void {
  port.on('message', (event) => {
    const data = event.data as { serial?: unknown; jpeg?: unknown } | null;
    // Ports carry handshake and teardown traffic too; a stray message must never
    // take the service -- and with it all four panels -- down.
    if (!data || typeof data.serial !== 'string') return;
    if (data.serial === PING_SERIAL) {
      console.log('frame channel confirmed');
      return;
    }

    const bytes = toBytes(data.jpeg);
    if (!bytes) {
      if (!warnedAboutPayload) {
        warnedAboutPayload = true;
        console.error(
          `frame payload is not byte-like: ${Object.prototype.toString.call(data.jpeg)}`,
        );
      }
      return;
    }
    pending.set(data.serial, bytes);
    scheduleDrain();
  });
  port.start();
}

// Checked often, but only actually writes to a panel that has gone quiet.
setInterval(runKeepAlive, 5000);

process.parentPort.on('message', (event) => {
  if (event.ports.length > 0) {
    attachFramePort(event.ports[0]);
    return;
  }
  const payload = event.data as { id?: unknown; req?: HidRequest } | null;
  if (!payload || typeof payload.id !== 'number' || !payload.req) return;
  const { id, req } = payload as { id: number; req: HidRequest };
  let res: HidResponse;
  try {
    res = handle(req);
  } catch (err) {
    res = { type: 'error', message: err instanceof Error ? err.message : String(err) };
  }
  process.parentPort.postMessage({ id, res });
});

// A crash in here would silently take all four panels down; make it loud, and
// close the handles so the panels are not left held by a dying process.
process.on('uncaughtException', (err) => {
  console.error('uncaughtException:', err);
  for (const panel of panels.values()) panel.close();
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('unhandledRejection:', reason);
});

process.on('exit', () => {
  for (const panel of panels.values()) panel.close();
});
