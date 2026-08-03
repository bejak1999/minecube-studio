/**
 * 0x5C image frames -- a JPEG spread over N interrupt reports.
 *
 * Per-report header (24 bytes), then up to 1000 bytes of JPEG:
 *
 *   0      0x5C
 *   1..2   BE16  bytes following offset 2, i.e. 21 + payload length
 *   3      image tag, constant across all chunks of one image
 *   4      0x00
 *   5..6   LE16  total chunk count
 *   7      chunk index, 0-based
 *   8      0x01
 *   9..23  zero
 *
 * No checksum, no stuffing, no acknowledgement -- the fixed 1024-byte report
 * size makes the framing unambiguous. See ../../../../PROTOCOL.md.
 */

import { CHUNK_DATA, IMAGE_HDR_LEN, MAX_CHUNKS, MAX_JPEG_BYTES } from '@shared/types';

export { CHUNK_DATA, IMAGE_HDR_LEN, MAX_CHUNKS, MAX_JPEG_BYTES };

export const IMAGE_MAGIC = 0x5c;

export class JpegTooLargeError extends Error {
  constructor(readonly byteLength: number, readonly chunks: number) {
    super(
      `JPEG is ${byteLength} bytes -> ${chunks} chunks, but the chunk index is ` +
        `one byte (max ${MAX_CHUNKS}). Lower the JPEG quality.`,
    );
    this.name = 'JpegTooLargeError';
  }
}

/**
 * Split `jpeg` into ready-to-send reports.
 *
 * `tag` groups the chunks of one image; the vendor software uses
 * `unix_seconds & 0xFF`. Only constancy across an image matters.
 */
export function buildImageChunks(jpeg: Buffer | Uint8Array, tag?: number): Buffer[] {
  const total = Math.ceil(jpeg.length / CHUNK_DATA);
  if (total > MAX_CHUNKS) throw new JpegTooLargeError(jpeg.length, total);

  const groupTag = tag ?? Math.floor(Date.now() / 1000) & 0xff;
  const chunks: Buffer[] = [];

  for (let index = 0; index < total; index++) {
    const start = index * CHUNK_DATA;
    const data = jpeg.subarray(start, start + CHUNK_DATA);
    const packet = Buffer.alloc(IMAGE_HDR_LEN + data.length);

    packet[0] = IMAGE_MAGIC;
    packet.writeUInt16BE(IMAGE_HDR_LEN - 3 + data.length, 1);
    packet[3] = groupTag;
    packet[4] = 0x00;
    packet.writeUInt16LE(total, 5);
    packet[7] = index;
    packet[8] = 0x01;
    // bytes 9..23 stay zero
    packet.set(data, IMAGE_HDR_LEN);

    chunks.push(packet);
  }
  return chunks;
}
