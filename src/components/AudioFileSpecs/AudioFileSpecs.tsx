import { formatBytes } from "../../lib/formatBytes";
import { audioExtensionFromPath } from "../../lib/supportedAudio";
import "./AudioFileSpecs.css";

export function AudioFileSpecs({
  filePath,
  sizeBytes,
  className,
}: {
  filePath: string;
  sizeBytes: number | null;
  className?: string;
}) {
  const format = audioExtensionFromPath(filePath).toUpperCase() || "AUDIO";
  const rootClassName = className
    ? `audio-file-specs ${className}`
    : "audio-file-specs";

  return (
    <div className={rootClassName}>
      <span className="audio-file-specs__format">{format}</span>
      <span className="audio-file-specs__size">
        {sizeBytes != null && sizeBytes > 0
          ? formatBytes(sizeBytes)
          : "Size unknown"}
      </span>
    </div>
  );
}
