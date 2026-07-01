import { audioExtensionFromPath } from "./supportedAudio";

export function formatCodec(codec: string | null | undefined): string | null {
  if (!codec) return null;
  const normalized = codec.trim().toLowerCase();
  if (!normalized) return null;

  switch (normalized) {
    case "mp3":
      return "MP3";
    case "flac":
      return "FLAC";
    case "aac":
      return "AAC";
    case "alac":
      return "ALAC";
    case "pcm":
      return "PCM";
    default:
      return normalized.toUpperCase();
  }
}

export function formatSampleRate(hz: number | null | undefined): string | null {
  if (hz == null || hz <= 0) return null;
  if (hz % 1000 === 0) {
    return `${hz / 1000} kHz`;
  }
  if (hz % 100 === 0) {
    return `${(hz / 1000).toFixed(1)} kHz`;
  }
  return `${hz} Hz`;
}

export function formatBitrate(bps: number | null | undefined): string | null {
  if (bps == null || bps <= 0) return null;
  if (bps >= 1_000_000) {
    return `${(bps / 1_000_000).toFixed(1)} Mbps`;
  }
  return `${Math.round(bps / 1000)} kbps`;
}

export function formatAudioFormatLabel(options: {
  codec?: string | null;
  sampleRate?: number | null;
  bitrate?: number | null;
  filePath?: string;
}): string {
  const parts = [
    formatCodec(options.codec) ??
      (audioExtensionFromPath(options.filePath ?? "").toUpperCase() || "AUDIO"),
    formatSampleRate(options.sampleRate),
    formatBitrate(options.bitrate),
  ].filter((part): part is string => Boolean(part));

  return parts.join(" · ");
}
