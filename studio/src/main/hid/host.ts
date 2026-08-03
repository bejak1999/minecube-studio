/**
 * Main-process side of the HID service: spawns the utility process, correlates
 * request/response pairs, and hands the renderer a direct MessagePort for frames.
 */
import { join } from 'node:path';
import { MessageChannelMain, utilityProcess, type UtilityProcess } from 'electron';

import type { HidRequest, HidResponse } from '@shared/types';

const REQUEST_TIMEOUT_MS = 8000;

export class HidHost {
  private child: UtilityProcess | null = null;
  private nextId = 1;
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

    this.child.stdout?.on('data', (d: Buffer) => process.stdout.write(`[hid] ${d}`));
    this.child.stderr?.on('data', (d: Buffer) => process.stderr.write(`[hid!] ${d}`));

    this.child.on('message', (message: { id: number; res: HidResponse }) => {
      const pending = this.waiting.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.waiting.delete(message.id);
      pending.resolve(message.res);
    });

    this.child.on('spawn', () => console.log('[hid] service spawned'));

    this.child.on('exit', (code) => {
      console.log(`[hid] service exited with code ${code}`);
      for (const pending of this.waiting.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error('HID service exited'));
      }
      this.waiting.clear();
      this.child = null;
    });
  }

  stop(): void {
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
  }
}

export const hidHost = new HidHost();
