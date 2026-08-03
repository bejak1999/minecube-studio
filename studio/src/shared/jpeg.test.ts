import { describe, expect, it } from 'vitest';

import { stripJpegAppSegments } from './jpeg';

/** Build a JPEG-shaped byte string from marker/payload pairs. */
function jpeg(segments: [number, number[]][], scan: number[] = [0x12, 0x34]): Uint8Array {
  const out: number[] = [0xff, 0xd8];
  for (const [marker, payload] of segments) {
    const length = payload.length + 2;
    out.push(0xff, marker, (length >> 8) & 0xff, length & 0xff, ...payload);
  }
  out.push(0xff, 0xda, 0x00, 0x04, 0x00, 0x00, ...scan, 0xff, 0xd9);
  return new Uint8Array(out);
}

const APP0 = [0x4a, 0x46, 0x49, 0x46, 0x00];
const ICC = [...Array(20).fill(0x41)];
const DQT = [...Array(64).fill(0x10)];

describe('stripJpegAppSegments', () => {
  it('removes an APP2 ICC segment', () => {
    const withIcc = jpeg([[0xe0, APP0], [0xe2, ICC], [0xdb, DQT]]);
    const without = jpeg([[0xe0, APP0], [0xdb, DQT]]);
    expect(Array.from(stripJpegAppSegments(withIcc))).toEqual(Array.from(without));
  });

  it('keeps APP0/JFIF, quantisation and Huffman tables', () => {
    const src = jpeg([[0xe0, APP0], [0xe2, ICC], [0xdb, DQT], [0xc4, [1, 2, 3]], [0xc0, [4, 5]]]);
    const out = stripJpegAppSegments(src);
    for (const marker of [0xe0, 0xdb, 0xc4, 0xc0]) {
      expect(Array.from(out).some((b, i) => b === 0xff && out[i + 1] === marker)).toBe(true);
    }
    expect(Array.from(out).some((b, i) => b === 0xff && out[i + 1] === 0xe2)).toBe(false);
  });

  it('leaves scan data untouched', () => {
    const scan = [0xaa, 0xbb, 0xcc, 0xdd, 0xee];
    const out = stripJpegAppSegments(jpeg([[0xe0, APP0], [0xe2, ICC]], scan));
    expect(Array.from(out.subarray(out.length - scan.length - 2, out.length - 2))).toEqual(scan);
    expect(Array.from(out.subarray(-2))).toEqual([0xff, 0xd9]);
  });

  it('returns the very same object when there is nothing to drop', () => {
    const clean = jpeg([[0xe0, APP0], [0xdb, DQT]]);
    expect(stripJpegAppSegments(clean)).toBe(clean);
  });

  it('leaves data that is not a JPEG alone', () => {
    const notJpeg = new Uint8Array([1, 2, 3, 4, 5]);
    expect(stripJpegAppSegments(notJpeg)).toBe(notJpeg);
  });

  it('does not truncate a segment whose length runs past the end', () => {
    const truncated = new Uint8Array([0xff, 0xd8, 0xff, 0xe2, 0x7f, 0xff, 0x41, 0x41]);
    expect(Array.from(stripJpegAppSegments(truncated))).toEqual(Array.from(truncated));
  });
});
