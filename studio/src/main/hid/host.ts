/**
 * Main-process side of the HID service: spawns the utility process, correlates
 * request/response pairs, and hands the renderer a direct MessagePort for frames.
 */
import { join } from 'node:path';
import { MessageChannelMain, utilityProcess, type UtilityProcess } from 'electron';

import type { HidRequest, HidResponse } from '@shared/types';

import { logDiag } from '../diagnostics';

const REQUEST_TIMEOUT_MS = 8000;

export class HidHost {
  private child: UtilityProcess | null = null;
  private nextId = 1;
  /** Set by stop() so a deliberate shutdown is not mistaken for a crash. */
  private stopping = false;
  private restartTimer: NodeJS.Timeout | null = null;
  /** Whoever the frame port was last handed to, so it can be re-established after a restart. */
  private lastTarget: Electron.WebContents | null = null;
  /** Called once the panels are back, so the renderer can push a fresh frame to each. */
  onRestarted: (() => void) | null = null;
  private readonly waiting = new Map<
    number,
    { resolve: (res: HidResponse) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }
  >();

  start(): void {
    if (this.child) return;
    // electron-vite emits the service next to the main bundle.
    this.child = utilityProcess.fork(join(__dirname, 'service.js'), [], {
      serviceName: 'minecube-hid',
      // 'pipe' rather than 'inherit': utilityProcess does not reliably forward
      // inherited stderr, and a crash in here is otherwise invisible.
      stdio: 'pipe',
    });

    // The service is a separate process, so its output is the only window into
    // what the panels are actually doing. Persist it -- a packaged build shows
    // no console, and these lines are the record of a panel dropping off the bus.
    const forward = (prefix: string) => (d: Buffer) => {
      for (const line of d.toString().split(/\r?\n/)) {
        if (line.trim()) logDiag(`${prefix} ${line}`);
      }
    };
    this.child.stdout?.on('data', forward('[hid]'));
    this.child.stderr?.on('data', forward('[hid!]'));

    this.child.on('message', (message: { id: number; res: HidResponse }) => {
      const pending = this.waiting.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.waiting.delete(message.id);
      pending.resolve(message.res);
    });

    this.child.on('spawn', () => logDiag('[hid] service spawned'));

    this.child.on('exit', (code) => {
      logDiag(`[hid] service exited with code ${code}`);
      for (const pending of this.waiting.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error('HID service exited'));
      }
      this.waiting.clear();
      this.child = null;
      // Nothing used to bring it back. When this process dies every panel
      // freezes and stays frozen, because all USB traffic goes through it --
      // and the only way out was restarting the whole app by hand. The
      // diagnostics log shows it happening three times in a week, always
      // unattended overnight.
      if (!this.stopping) this.scheduleRestart();
    });
  }

  /** Bring the service back after a crash, then re-establish everything that hung off it. */
  private scheduleRestart(): void {
    if (this.restartTimer || this.stopping) return;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (this.stopping || this.child) return;
      logDiag('[hid] restarting service after crash');
      this.start();
      // The renderer's frame port pointed at the dead process; without a fresh
      // one every frame would be posted into nothing.
      if (this.lastTarget && !this.lastTarget.isDestroyed()) {
        try {
          this.openFramePort(this.lastTarget);
        } catch (err) {
          logDiag(`[hid] could not re-open frame port: ${String(err)}`);
        }
      }
      void this.reopenPanels();
    }, 2000);
  }

  /**
   * A freshly spawned service knows about no panels at all -- it has to
   * enumerate and shake hands again before anything can be drawn.
   */
  private async reopenPanels(): Promise<void> {
    try {
      const found = await this.send({ type: 'discover' });
      if (found.type !== 'panels') return;
      const serials = found.panels.map((p) => p.serial);
      if (serials.length > 0) await this.send({ type: 'connect', serials });
      logDiag(`[hid] reconnected ${serials.length} panel(s) after service restart`);
      // Static content produces no frames on its own, so ask for a repaint.
      this.onRestarted?.();
    } catch (err) {
      logDiag(`[hid] reconnect after service restart failed: ${String(err)}`);
    }
  }

  stop(): void {
    this.stopping = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    this.child?.kill();
    this.child = null;
  }

  send(req: HidRequest): Promise<HidResponse> {
    if (!this.child) return Promise.reject(new Error('HID service is not running'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        reject(new Error(`HID request '${req.type}' timed out`));
      }, REQUEST_TIMEOUT_MS);
      this.waiting.set(id, { resolve, reject, timer });
      this.child!.postMessage({ id, req });
    });
  }

  /**
   * Wire the renderer straight to the service for frame data, so ~80 frames/s
   * never touch the main process event loop.
   */
  openFramePort(target: Electron.WebContents): void {
    if (!this.child) throw new Error('HID service is not running');
    const { port1, port2 } = new MessageChannelMain();
    this.child.postMessage(null, [port1]);
    target.postMessage('frames:port', null, [port2]);
    this.lastTarget = target;
  }
}

export const hidHost = new HidHost();
