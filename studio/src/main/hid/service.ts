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
    if (!panels.has(desc.serial)) panels.set(desc.serial, new Panel(desc));
  }
  for (const [serial, panel] of panels) {
    if (seen.has(serial)) continue;
    panel.close(); // unplugged
    panels.delete(serial);
  }
  return [...panels.values()].map(statusOf);
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
      console.warn(`frame for closed panel ${panel.port}`);
      continue;
    }
    try {
      const chunks = panel.sendJpeg(jpeg);
      if (panel.framesSent === 1) {
        console.log(`${panel.port}: first frame written, ${jpeg.length} bytes in ${chunks} chunks`);
      }
      panel.lastError = null;
    } catch (err) {
      panel.lastError = err instanceof Error ? err.message : String(err);
      console.error(`${panel.port}: write failed: ${panel.lastError}`);
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
