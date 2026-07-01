import { formatAudioFormatLabel } from "../../lib/formatAudio";
import { formatBytes } from "../../lib/formatBytes";
import "./AudioFileSpecs.css";

export function AudioFileSpecs({
  codec,
  sampleRate,
  bitrate,
  filePath,
  sizeBytes,
  className,
  formatLabel,
  sizeLabel,
}: {
  codec?: string | null;
  sampleRate?: number | null;
  bitrate?: number | null;
  filePath?: string;
  sizeBytes?: number | null;
  className?: string;
  formatLabel?: string;
  sizeLabel?: string;
}) {
  const format =
    formatLabel ??
    formatAudioFormatLabel({ codec, sampleRate, bitrate, filePath });
  const size =
    sizeLabel ??
    (sizeBytes != null && sizeBytes > 0
      ? formatBytes(sizeBytes)
      : "Size unknown");
  const rootClassName = className
    ? `audio-file-specs ${className}`
    : "audio-file-specs";

  return (
    <div className={rootClassName}>
      <span className="audio-file-specs__format">{format}</span>
      <span className="audio-file-specs__size">{size}</span>
    </div>
  );
}
