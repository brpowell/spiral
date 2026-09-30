/** Uncompressed zip. Sound Lab uses this to save one WAV per transport control. */

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let crc = n;
  for (let k = 0; k < 8; k++) {
    crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  CRC_TABLE[n] = crc >>> 0;
}

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ (data[i] ?? 0)) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function zipStored(
  files: { name: string; data: Uint8Array }[],
): Uint8Array {
  const encoded = files.map((file) => ({
    name: new TextEncoder().encode(file.name),
    data: file.data,
    crc: crc32(file.data),
  }));

  let size = 22;
  for (const file of encoded) {
    size += 30 + file.name.length + file.data.length;
    size += 46 + file.name.length;
  }

  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  const localOffsets: number[] = [];
  let offset = 0;

  for (const file of encoded) {
    localOffsets.push(offset);
    view.setUint32(offset, 0x04034b50, true);
    view.setUint16(offset + 4, 20, true);
    view.setUint32(offset + 14, file.crc, true);
    view.setUint32(offset + 18, file.data.length, true);
    view.setUint32(offset + 22, file.data.length, true);
    view.setUint16(offset + 26, file.name.length, true);
    out.set(file.name, offset + 30);
    out.set(file.data, offset + 30 + file.name.length);
    offset += 30 + file.name.length + file.data.length;
  }

  const centralStart = offset;
  encoded.forEach((file, index) => {
    view.setUint32(offset, 0x02014b50, true);
    view.setUint16(offset + 4, 20, true);
    view.setUint16(offset + 6, 20, true);
    view.setUint32(offset + 16, file.crc, true);
    view.setUint32(offset + 20, file.data.length, true);
    view.setUint32(offset + 24, file.data.length, true);
    view.setUint16(offset + 28, file.name.length, true);
    view.setUint32(offset + 42, localOffsets[index] ?? 0, true);
    out.set(file.name, offset + 46);
    offset += 46 + file.name.length;
  });

  const centralSize = offset - centralStart;
  view.setUint32(offset, 0x06054b50, true);
  view.setUint16(offset + 8, encoded.length, true);
  view.setUint16(offset + 10, encoded.length, true);
  view.setUint32(offset + 12, centralSize, true);
  view.setUint32(offset + 16, centralStart, true);
  return out;
}
