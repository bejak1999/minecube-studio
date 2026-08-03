/**
 * Trim a JPEG down to the segments the panel firmware is known to accept.
 *
 * Chromium's canvas encoder emits an APP2 segment carrying a 472-byte sRGB ICC
 * profile. The vendor software never sends one: its frames are APP0/JFIF, DQT,
 * SOF0, DHT, SOS and nothing else. Everything else about the two encoders'
 * output already matches -- baseline, 720x720, 4:2:0 -- so the extra segment is
 * both the one structural difference and 472 bytes of waste per frame.
 */

const SOI = 0xd8;
const SOS = 0xda;
const EOI = 0xd9;

/** APPn markers the vendor software never emits: EXIF, ICC, Photoshop, Adobe. */
const DROP = new Set([0xe1, 0xe2, 0xed, 0xee]);

/** Markers that stand alone, without a length field. */
function isStandalone(marker: number): boolean {
  return marker === SOI || marker === EOI || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01;
}

export function stripJpegAppSegments(input: Uint8Array): Uint8Array {
  if (input.length < 4 || input[0] !== 0xff || input[1] !== SOI) return input;

  const keep: [number, number][] = [[0, 2]];
  let i = 2;
  let dropped = 0;

  while (i + 3 < input.length) {
    if (input[i] !== 0xff) break; // desynchronised; keep the rest verbatim
    const marker = input[i + 1];

    if (isStandalone(marker)) {
      keep.push([i, i + 2]);
      i += 2;
      continue;
    }
    // Scan data runs to the end of the file; nothing after SOS is a segment.
    if (marker === SOS) break;

    const length = (input[i + 2] << 8) | input[i + 3];
    if (length < 2) break; // malformed
    const end = i + 2 + length;
    if (end > input.length) break;

    if (DROP.has(marker)) dropped += end - i;
    else keep.push([i, end]);
    i = end;
  }

  if (dropped === 0) return input;
  keep.push([i, input.length]); // SOS header plus scan data

  const out = new Uint8Array(input.length - dropped);
  let at = 0;
  for (const [from, to] of keep) {
    out.set(input.subarray(from, to), at);
    at += to - from;
  }
  return out.subarray(0, at);
}
