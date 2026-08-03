/**
 * 0x5A text frames -- the panel's HTTP-like request/response protocol.
 *
 * Wire format:   5A | len_hi len_lo | <text> | chk | 5A
 *
 * `len` is the total frame length including both markers and the checksum;
 * `chk` is `(len_hi + len_lo + sum(text)) & 0xFF`. Both describe the *unstuffed*
 * frame -- stuffing is applied last, so a stuffed frame is longer than its own
 * length field. See ../../../../PROTOCOL.md.
 */

import { PACKET_LEN } from '@shared/types';

export { PACKET_LEN };

export const TEXT_MAGIC = 0x5a;
export const ESCAPE = 0x5b;

/** Escape the two bytes that would otherwise be mistaken for frame markers. */
export function stuff(data: Buffer): Buffer {
  let needed = 0;
  for (const b of data) if (b === TEXT_MAGIC || b === ESCAPE) needed++;
  if (needed === 0) return data;

  const out = Buffer.allocUnsafe(data.length + needed);
  let j = 0;
  for (const b of data) {
    if (b === TEXT_MAGIC) {
      out[j++] = ESCAPE;
      out[j++] = 0x01;
    } else if (b === ESCAPE) {
      out[j++] = ESCAPE;
      out[j++] = 0x02;
    } else {
      out[j++] = b;
    }
  }
  return out;
}

/** Undo {@link stuff} over `raw[1..]`, stopping at the closing 0x5A. */
export function unstuff(raw: Buffer): Buffer | null {
  const out: number[] = [];
  let i = 1;
  while (i < raw.length) {
    const b = raw[i];
    if (b === TEXT_MAGIC) return Buffer.from(out); // closing marker
    if (b === ESCAPE) {
      const next = raw[i + 1];
      if (next === 0x01) out.push(TEXT_MAGIC);
      else if (next === 0x02) out.push(ESCAPE);
      else return null; // invalid escape
      i += 2;
      continue;
    }
    out.push(b);
    i++;
  }
  return null; // never terminated
}

export interface TextRequest {
  command: string;
  body?: string;
  seq: number;
  /** Unix milliseconds; defaults to now. Exposed so tests can replay captures. */
  dateMs?: number;
}

export function buildTextFrame({ command, body = '', seq, dateMs }: TextRequest): Buffer {
  let head = `${command}\r\nSeqNumber=${seq}\r\nDate=${dateMs ?? Date.now()}\r\n`;
  if (body) head += `ContentType=json\r\nContentLength=${Buffer.byteLength(body)}\r\n`;
  const text = Buffer.from(`${head}\r\n${body}`, 'latin1');

  const total = 3 + text.length + 2;
  const length = Buffer.from([(total >> 8) & 0xff, total & 0xff]);
  let sum = length[0] + length[1];
  for (const b of text) sum += b;

  const inner = stuff(Buffer.concat([length, text, Buffer.from([sum & 0xff])]));
  return Buffer.concat([Buffer.from([TEXT_MAGIC]), inner, Buffer.from([TEXT_MAGIC])]);
}

export interface TextReply {
  status: string;
  headers: Record<string, string>;
  body: string;
  json: Record<string, unknown> | null;
}

export function parseTextFrame(raw: Buffer): TextReply | null {
  if (raw.length < 6 || raw[0] !== TEXT_MAGIC) return null;
  const inner = unstuff(raw);
  if (!inner || inner.length < 3) return null;

  const total = (inner[0] << 8) | inner[1];
  const text = inner.subarray(2, inner.length - 1);
  const checksum = inner[inner.length - 1];
  if (total !== 3 + text.length + 2) return null;

  let sum = inner[0] + inner[1];
  for (const b of text) sum += b;
  if ((sum & 0xff) !== checksum) return null;

  const decoded = text.toString('utf8');
  const split = decoded.indexOf('\r\n\r\n');
  const head = split < 0 ? decoded : decoded.slice(0, split);
  const body = split < 0 ? '' : decoded.slice(split + 4);

  const lines = head.split('\r\n');
  const headers: Record<string, string> = {};
  for (const line of lines.slice(1)) {
    const eq = line.indexOf('=');
    if (eq > 0) headers[line.slice(0, eq)] = line.slice(eq + 1);
  }

  let json: Record<string, unknown> | null = null;
  if (body.startsWith('{')) {
    try {
      json = JSON.parse(body) as Record<string, unknown>;
    } catch {
      json = null;
    }
  }
  return { status: lines[0], headers, body, json };
}
