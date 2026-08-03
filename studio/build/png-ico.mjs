/**
 * Minimal ICO packer: Windows Vista+ accepts PNG-compressed frames directly
 * inside an .ico container, so this just concatenates PNGs we already have
 * with the small ICONDIR/ICONDIRENTRY header structure -- no BMP/DIB
 * conversion needed.
 */
export const PNG = {
  /** @param {{size:number,buf:Buffer}[]} entries */
  buildIco(entries) {
    const count = entries.length;
    const headerSize = 6 + 16 * count;
    let offset = headerSize;
    const header = Buffer.alloc(headerSize);
    header.writeUInt16LE(0, 0); // reserved
    header.writeUInt16LE(1, 2); // type = icon
    header.writeUInt16LE(count, 4);

    entries.forEach((entry, i) => {
      const pos = 6 + i * 16;
      const dim = entry.size >= 256 ? 0 : entry.size; // 0 means 256
      header.writeUInt8(dim, pos + 0); // width
      header.writeUInt8(dim, pos + 1); // height
      header.writeUInt8(0, pos + 2); // color count
      header.writeUInt8(0, pos + 3); // reserved
      header.writeUInt16LE(1, pos + 4); // color planes
      header.writeUInt16LE(32, pos + 6); // bits per pixel
      header.writeUInt32LE(entry.buf.length, pos + 8); // image size
      header.writeUInt32LE(offset, pos + 12); // image offset
      offset += entry.buf.length;
    });

    return Buffer.concat([header, ...entries.map((e) => e.buf)]);
  },
};
