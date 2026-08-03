/**
 * The TypeScript port is checked against the very same capture-derived vectors
 * as the Python driver (../../../../vectors.json), so both implementations are
 * pinned to bytes the vendor software actually put on the wire.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { buildTextFrame, PACKET_LEN, parseTextFrame, stuff, unstuff } from './frames';
import { buildImageChunks, CHUNK_DATA, IMAGE_HDR_LEN, MAX_JPEG_BYTES } from './image';

interface Vectors {
  text_out: { frame: number; dev: number; command: string; seq: number; body: string; hex: string }[];
  text_in: { frame: number; dev: number; hex: string; stuffed: boolean; kind: 'conn' | 'ack' }[];
  image: {
    first_frame: number;
    jpeg_len: number;
    chunk_count: number;
    tag: number;
    headers: Record<string, string>;
  };
}

const vectors = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../../vectors.json', import.meta.url)), 'utf8'),
) as Vectors;

describe('0x5A request frames', () => {
  it.each(vectors.text_out)('replays frame $frame ($command) byte-exactly', (v) => {
    const expected = Buffer.from(v.hex, 'hex');
    const dateMs = Number(/Date=(\d+)/.exec(expected.toString('latin1'))![1]);
    const got = buildTextFrame({ command: v.command, body: v.body, seq: v.seq, dateMs });
    expect(got.toString('hex')).toBe(expected.toString('hex'));
  });
});

describe('0x5A response parsing', () => {
  it.each(vectors.text_in)('parses frame $frame ($kind, stuffed=$stuffed)', (v) => {
    // pad the way a 1024-byte HID report arrives
    const raw = Buffer.concat([Buffer.from(v.hex, 'hex')], PACKET_LEN);
    const reply = parseTextFrame(raw);
    expect(reply).not.toBeNull();
    expect(reply!.status).toBe('1 200');
    expect(reply!.headers.AckNumber).toBeDefined();
    if (v.kind === 'conn') {
      expect(reply!.json).toMatchObject({ sn: expect.any(String), degree: expect.any(Number) });
    }
  });

  it('exercises byte stuffing', () => {
    expect(vectors.text_in.filter((v) => v.stuffed).length).toBeGreaterThanOrEqual(2);
  });

  it("unstuffing restores the 'Z' in the serial number", () => {
    const conn = vectors.text_in.find((v) => v.kind === 'conn')!;
    const reply = parseTextFrame(Buffer.from(conn.hex, 'hex'));
    // transmitted as BY[\x01L..., must come back as BYZL...
    expect(reply!.json!.sn).toMatch(/^BYZL/);
  });

  it.each([
    ['corrupted checksum', (b: Buffer) => (b[b.length - 2] ^= 0xff)],
    ['missing terminator', (b: Buffer) => (b[b.length - 1] = 0x00)],
  ])('rejects a frame with a %s', (_label, corrupt) => {
    const ack = vectors.text_in.find((v) => v.kind === 'ack' && !v.stuffed)!;
    const bad = Buffer.from(ack.hex, 'hex');
    corrupt(bad);
    expect(parseTextFrame(bad)).toBeNull();
  });
});

describe('byte stuffing', () => {
  it.each([
    ['a lone marker', Buffer.from([0x5a])],
    ['a lone escape', Buffer.from([0x5b])],
    ['markers back to back', Buffer.from([0x5a, 0x5b, 0x5a])],
    ['marker-free text', Buffer.from('POST conn 1', 'latin1')],
    ['every byte value', Buffer.from(Array.from({ length: 256 }, (_, i) => i))],
  ])('round-trips %s', (_label, probe) => {
    const framed = Buffer.concat([Buffer.from([0x5a]), stuff(probe), Buffer.from([0x5a])]);
    expect(unstuff(framed)).toEqual(probe);
  });

  it('leaves marker-free data untouched', () => {
    const clean = Buffer.from('POST conn 1', 'latin1');
    expect(stuff(clean)).toBe(clean); // same object, no copy
  });

  it('rejects an invalid escape', () => {
    expect(unstuff(Buffer.from([0x5a, 0x41, 0x5b, 0x09, 0x41, 0x5a]))).toBeNull();
  });

  it('rejects an unterminated frame', () => {
    expect(unstuff(Buffer.from([0x5a, 0x41, 0x41, 0x41]))).toBeNull();
  });

  it('keeps requests parseable when the checksum lands on a marker byte', () => {
    let found = 0;
    for (let seq = 0; seq < 4000 && found < 2; seq++) {
      const f = buildTextFrame({ command: 'POST conn 1', seq, dateMs: 1785107086581 });
      if (!f.includes(Buffer.from([0x5b, 0x01])) && !f.includes(Buffer.from([0x5b, 0x02]))) continue;
      found++;
      const inner = unstuff(f)!;
      const text = inner.subarray(2, inner.length - 1);
      let sum = inner[0] + inner[1];
      for (const b of text) sum += b;
      expect((inner[0] << 8) | inner[1]).toBe(3 + text.length + 2);
      expect(sum & 0xff).toBe(inner[inner.length - 1]);
    }
    expect(found).toBe(2);
  });
});

describe('0x5C image chunks', () => {
  const iv = vectors.image;
  // Only the length matters for framing, not the pixels.
  const jpeg = Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    Buffer.alloc(iv.jpeg_len - 4, 0x41),
    Buffer.from([0xff, 0xd9]),
  ]);
  const chunks = buildImageChunks(jpeg, iv.tag);

  it(`splits a ${iv.jpeg_len}-byte JPEG into ${iv.chunk_count} chunks`, () => {
    expect(chunks.length).toBe(iv.chunk_count);
  });

  it.each(Object.entries(iv.headers))('replays the header of chunk %s', (index, hex) => {
    expect(chunks[Number(index)].subarray(0, IMAGE_HDR_LEN).toString('hex')).toBe(hex);
  });

  it('round-trips through the reassembly used on the capture', () => {
    const parts = chunks.map((c) => c.subarray(IMAGE_HDR_LEN, 3 + c.readUInt16BE(1)));
    expect(Buffer.concat(parts).equals(jpeg)).toBe(true);
  });

  it('never exceeds one report per chunk', () => {
    expect(Math.max(...chunks.map((c) => c.length))).toBeLessThanOrEqual(PACKET_LEN);
  });

  it('rejects an oversized JPEG', () => {
    expect(() => buildImageChunks(Buffer.alloc(MAX_JPEG_BYTES + 1))).toThrow(/one byte/);
  });

  it('fills the last chunk with only the remaining bytes', () => {
    const odd = Buffer.alloc(CHUNK_DATA + 7, 0x42);
    const [, last] = buildImageChunks(odd, 0x10);
    expect(last.length).toBe(IMAGE_HDR_LEN + 7);
    expect(last.readUInt16BE(1)).toBe(IMAGE_HDR_LEN - 3 + 7);
  });
});
