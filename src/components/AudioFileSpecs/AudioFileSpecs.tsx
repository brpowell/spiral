import { formatBytes } from "../../lib/formatBytes";
import { audioExtensionFromPath } from "../../lib/supportedAudio";
import "./AudioFileSpecs.css";

export function AudioFileSpecs({
  filePath,
  sizeBytes,
  className,
  formatLabel,
  sizeLabel,
}: {
  filePath?: string;
  sizeBytes?: number | null;
  className?: string;
  formatLabel?: string;
  sizeLabel?: string;
}) {
  const format =
    formatLabel ??
    (audioExtensionFromPath(filePath ?? "").toUpperCase() || "AUDIO");
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
