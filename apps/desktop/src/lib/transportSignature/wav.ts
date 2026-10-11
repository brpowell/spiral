/** 16-bit mono PCM WAV. Used by Sound Lab export and unit tests. */
export function encodeWavPcm16(
  samples: Float32Array,
  sampleRate: number,
): Uint8Array {
  const dataLength = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }
  return new Uint8Array(buffer);
}

export function peakDb(samples: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const amplitude = Math.abs(samples[i] ?? 0);
    if (amplitude > peak) peak = amplitude;
  }
  if (peak < 1e-8) return Number.NEGATIVE_INFINITY;
  return 20 * Math.log10(peak);
}

export function formatPeakDb(db: number): string {
  if (!Number.isFinite(db)) return "Silent";
  const rounded = (Math.round(db * 10) / 10).toFixed(1);
  return db >= -0.1 ? `Peak ${rounded} dB · clipping` : `Peak ${rounded} dB`;
}

function writeString(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}
