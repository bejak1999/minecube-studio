/**
 * One LCD panel, spoken to over its vendor HID interface.
 *
 * Every method here blocks -- hidapi's read and write are synchronous syscalls.
 * This class therefore belongs in the HID utility process, never on Electron's
 * main thread. See ../hid/service.ts.
 */
import HID from 'node-hid';

import type { PanelDescriptor, PanelInfo } from '@shared/types';
import { PRODUCT_ID, VENDOR_ID } from '@shared/types';

import { buildTextFrame, PACKET_LEN, parseTextFrame, type TextReply } from './frames';
import { buildImageChunks } from './image';

/** `SeqNumber` is one counter shared by every panel, as in the vendor software. */
let sequence = 0;
function nextSeq(): number {
  return sequence++;
}

/** Reads "USB1" out of "ThermalTake USB1 Device". */
function portOf(product: string): string {
  return product.split(/\s+/).find((w) => w.startsWith('USB')) ?? '?';
}

export function discoverPanels(): PanelDescriptor[] {
  return HID.devices(VENDOR_ID, PRODUCT_ID)
    .filter((d) => d.path && d.serialNumber)
    .map((d) => ({
      serial: d.serialNumber!,
      product: d.product ?? '',
      port: portOf(d.product ?? ''),
      path: d.path!,
    }))
    .sort((a, b) => a.port.localeCompare(b.port));
}

export class Panel {
  readonly serial: string;
  readonly product: string;
  readonly port: string;
  readonly path: string;

  info: PanelInfo | null = null;
  lastError: string | null = null;
  writes = 0;
  framesSent = 0;

  private dev: HID.HID | null = null;

  constructor(desc: PanelDescriptor) {
    this.serial = desc.serial;
    this.product = desc.product;
    this.port = desc.port;
    this.path = desc.path;
  }

  get isOpen(): boolean {
    return this.dev !== null;
  }

  open(): void {
    if (this.dev) return;
    this.dev = new HID.HID(this.path);
  }

  close(): void {
    if (!this.dev) return;
    try {
      this.dev.close();
    } finally {
      this.dev = null;
    }
  }

  /**
   * Send one report, padded to the panel's 1024-byte output report size.
   *
   * The report descriptor declares no report ID, so node-hid wants a leading
   * 0x00 in its place -- 1025 bytes go in, 1024 reach the endpoint.
   */
  private writeReport(packet: Buffer): void {
    if (!this.dev) throw new Error(`${this.port}: panel is not open`);
    const buf = Buffer.alloc(PACKET_LEN + 1);
    packet.copy(buf, 1);
    this.dev.write(buf);
    this.writes++;
  }

  private request(command: string, payload?: unknown, timeoutMs = 1000, retries = 2): TextReply | null {
    const body = payload === undefined ? '' : JSON.stringify(payload);
    for (let attempt = 0; attempt <= retries; attempt++) {
      // A retry carries a fresh Date, so the frame -- and its checksum -- differ.
      this.writeReport(buildTextFrame({ command, body, seq: nextSeq() }));
      const data = this.dev!.readTimeout(timeoutMs);
      if (data && data.length) {
        const reply = parseTextFrame(Buffer.from(data));
        if (reply) return reply;
      }
    }
    return null;
  }

  /** The four-command handshake the vendor software performs. */
  connect(): PanelInfo {
    this.open();
    const reply = this.request('POST conn 1');
    if (!reply) throw new Error(`${this.port}: no answer to 'POST conn 1'`);
    if (reply.json) this.info = reply.json as unknown as PanelInfo;

    this.request('POST power 1', { event: 'resume' });
    this.request('POST displayInSleep 1', { enable: false });
    this.request('POST realtimeDisplay 1', { enable: true });

    this.lastError = null;
    if (!this.info) throw new Error(`${this.port}: handshake returned no device info`);
    return this.info;
  }

  setRealtime(enable: boolean): void {
    this.request('POST realtimeDisplay 1', { enable });
  }

  /**
   * One cheap write whose only job is to stop the endpoint looking idle.
   *
   * Windows' USB selective suspend powers down a device that has seen no
   * traffic for a while, and this hardware does not reliably survive that --
   * it comes back as "device not recognized" and needs a 12 V power cycle.
   * Static content produces no writes at all here, because the compositor
   * only sends when the picture actually changes, so an unattended cube can
   * sit silent for hours and invite exactly that.
   *
   * Deliberately does not go through request(): that retries and blocks for
   * up to a second per attempt, and this runs on the same thread as the frame
   * writes. One report out, whatever came back drained, done.
   */
  keepAlive(): void {
    this.writeReport(
      buildTextFrame({ command: 'POST realtimeDisplay 1', body: JSON.stringify({ enable: true }), seq: nextSeq() }),
    );
    try {
      this.dev?.readTimeout(50);
    } catch {
      // nothing waiting, or it went away between the write and the read
    }
  }

  /** Push one baseline JPEG. Returns the number of reports written. */
  sendJpeg(jpeg: Buffer | Uint8Array, tag?: number): number {
    const chunks = buildImageChunks(jpeg, tag);
    for (const chunk of chunks) this.writeReport(chunk);
    this.framesSent++;
    return chunks.length;
  }
}
