/**
 * Minimal GIF89a encoder for tests. Lets decode/composite regressions run
 * against small, fully synthetic files instead of checked-in binaries.
 *
 * Pixel data is LZW-encoded with periodic clear codes, so the output is not
 * compact, but it is valid and decodes with any standard GIF reader.
 */

export type GifColor = [number, number, number];

export interface GifFixtureFrame {
  /** Palette indices for the frame rectangle, row-major. */
  pixels: Uint8Array;
  /** Frame rectangle; defaults to the full logical screen. */
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  /** Rounded to GIF's 10ms resolution. */
  delayMs: number;
  /** Palette index treated as transparent for this frame. */
  transparentIndex?: number;
  /** 1 = leave in place (default), 2 = restore to background, 3 = restore previous. */
  disposal?: 0 | 1 | 2 | 3;
}

export interface GifFixtureOptions {
  width: number;
  height: number;
  palette: GifColor[];
  frames: GifFixtureFrame[];
  /** `0` = loop forever, `n` = repeat n times, `null`/omitted = no NETSCAPE extension. */
  loopCount?: number | null;
}

function bitsFor(colorCount: number): number {
  let bits = 1;
  while (1 << bits < colorCount) bits += 1;
  return bits;
}

function lzwEncode(pixels: Uint8Array, minCodeSize: number): number[] {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  const codeSize = minCodeSize + 1;
  const out: number[] = [];
  let current = 0;
  let bits = 0;

  const emit = (code: number) => {
    current |= code << bits;
    bits += codeSize;
    while (bits >= 8) {
      out.push(current & 0xff);
      current >>= 8;
      bits -= 8;
    }
  };

  // Emitting only literals and clearing before the table can outgrow the
  // current code width keeps the encoder trivial.
  emit(clear);
  let sinceClear = 0;
  for (const pixel of pixels) {
    emit(pixel);
    sinceClear += 1;
    if (sinceClear === clear - 2) {
      emit(clear);
      sinceClear = 0;
    }
  }
  emit(eoi);
  if (bits > 0) out.push(current & 0xff);
  return out;
}

function le16(value: number): number[] {
  return [value & 0xff, (value >> 8) & 0xff];
}

export function encodeGifFixture(options: GifFixtureOptions): Uint8Array {
  const { width, height, palette, frames, loopCount } = options;
  const tableBits = Math.max(2, bitsFor(palette.length));
  const tableSize = 1 << tableBits;
  const bytes: number[] = [];

  for (const ch of "GIF89a") bytes.push(ch.charCodeAt(0));
  bytes.push(...le16(width), ...le16(height));
  bytes.push(0x80 | ((tableBits - 1) << 4) | (tableBits - 1), 0, 0);
  for (let i = 0; i < tableSize; i += 1) {
    bytes.push(...(palette[i] ?? [0, 0, 0]));
  }

  if (loopCount !== undefined && loopCount !== null) {
    bytes.push(0x21, 0xff, 0x0b);
    for (const ch of "NETSCAPE2.0") bytes.push(ch.charCodeAt(0));
    bytes.push(0x03, 0x01, ...le16(loopCount), 0x00);
  }

  for (const frame of frames) {
    const fw = frame.width ?? width;
    const fh = frame.height ?? height;
    if (frame.pixels.length !== fw * fh) {
      throw new Error(
        `frame has ${frame.pixels.length} pixels, expected ${fw * fh}`,
      );
    }
    const hasTransparency = frame.transparentIndex !== undefined;
    bytes.push(
      0x21,
      0xf9,
      0x04,
      ((frame.disposal ?? 1) << 2) | (hasTransparency ? 1 : 0),
      ...le16(Math.round(frame.delayMs / 10)),
      frame.transparentIndex ?? 0,
      0x00,
    );
    bytes.push(
      0x2c,
      ...le16(frame.left ?? 0),
      ...le16(frame.top ?? 0),
      ...le16(fw),
      ...le16(fh),
      0x00,
    );
    bytes.push(tableBits);
    const data = lzwEncode(frame.pixels, tableBits);
    for (let offset = 0; offset < data.length; offset += 255) {
      const chunk = data.slice(offset, offset + 255);
      bytes.push(chunk.length, ...chunk);
    }
    bytes.push(0x00);
  }

  bytes.push(0x3b);
  return Uint8Array.from(bytes);
}
