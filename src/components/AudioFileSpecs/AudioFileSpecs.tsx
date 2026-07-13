import { audioExtensionFromPath } from "../../lib/supportedAudio";
import {
  formatBitrate,
  formatCodec,
  formatSampleRate,
} from "../../lib/formatAudio";
import { formatBytes } from "../../lib/formatBytes";
import { formatDateAdded } from "../../lib/format";
import {
  IconAudioWaveform,
  IconBitrate,
  IconCalendarPlus,
  IconFileMusic,
  IconHardDrive,
} from "../icons";
import "./AudioFileSpecs.css";

function SpecItem({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: typeof IconFileMusic;
}) {
  return (
    <div className="audio-file-specs__item">
      <dt className="audio-file-specs__label">
        <Icon className="audio-file-specs__icon" aria-hidden />
        {label}
      </dt>
      <dd className="audio-file-specs__value">{value}</dd>
    </div>
  );
}

export function AudioFileSpecs({
  codec,
  sampleRate,
  bitrate,
  filePath,
  sizeBytes,
  dateAdded,
  className,
  formatLabel,
  sizeLabel,
}: {
  codec?: string | null;
  sampleRate?: number | null;
  bitrate?: number | null;
  filePath?: string;
  sizeBytes?: number | null;
  dateAdded?: string | null;
  className?: string;
  formatLabel?: string;
  sizeLabel?: string;
}) {
  const codecValue =
    formatLabel ??
    formatCodec(codec) ??
    (audioExtensionFromPath(filePath ?? "").toUpperCase() || null);
  const sampleRateValue = formatLabel
    ? null
    : formatSampleRate(sampleRate);
  const bitrateValue = formatLabel ? null : formatBitrate(bitrate);
  const sizeValue =
    sizeLabel ??
    (sizeBytes != null && sizeBytes > 0
      ? formatBytes(sizeBytes)
      : "Size unknown");
  const dateAddedValue =
    dateAdded != null && dateAdded !== ""
      ? formatDateAdded(dateAdded)
      : null;
  const rootClassName = className
    ? `audio-file-specs ${className}`
    : "audio-file-specs";

  return (
    <dl className={rootClassName}>
      {codecValue ? (
        <SpecItem label="Codec" value={codecValue} icon={IconFileMusic} />
      ) : null}
      {sampleRateValue ? (
        <SpecItem
          label="Sample Rate"
          value={sampleRateValue}
          icon={IconAudioWaveform}
        />
      ) : null}
      {bitrateValue ? (
        <SpecItem label="Bitrate" value={bitrateValue} icon={IconBitrate} />
      ) : null}
      <SpecItem label="Size" value={sizeValue} icon={IconHardDrive} />
      {dateAddedValue && dateAddedValue !== "—" ? (
        <SpecItem
          label="Date Added"
          value={dateAddedValue}
          icon={IconCalendarPlus}
        />
      ) : null}
    </dl>
  );
}
