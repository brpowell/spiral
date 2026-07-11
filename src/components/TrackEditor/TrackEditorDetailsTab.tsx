import { useEffect, useState } from "react";
import { useFileSize } from "../../hooks/useFileSize";
import { useFileExists } from "../../hooks/useFileExists";
import { formatBytes, formatDimensions } from "../../lib/formatBytes";
import {
  mixedFieldPlaceholder,
  type TrackEditorForm,
  type TrackEditorFormField,
} from "../../lib/trackMetadataForm";
import { revealInFileManagerLabel, revealTrackInFileManager } from "../../lib/fileManager";
import {
  discoverTrackFileMissing,
  isTrackMissingFile,
} from "../../lib/missingFileTrack";
import type { CoverArtCandidate } from "../../types/coverArt";
import type { Track } from "../../types/track";
import { ArtistChipField } from "../ArtistChipField/ArtistChipField";
import { TrackRating } from "../TrackRating/TrackRating";
import { AudioFileSpecs } from "../AudioFileSpecs/AudioFileSpecs";
import { EntityArt } from "../EntityArt/EntityArt";
import { Button } from "../common/Button/Button";
import { FieldLabel, FormField } from "../common/Field/Field";
import { AutocompleteInput } from "../common/AutocompleteInput/AutocompleteInput";
import { TextInput } from "../common/TextInput/TextInput";
import { IconWarning } from "../icons";

function CoverOptionMeta({ candidate }: { candidate: CoverArtCandidate }) {
  const [dims, setDims] = useState<{ w: number; h: number } | null>(() =>
    candidate.width != null && candidate.height != null
      ? { w: candidate.width, h: candidate.height }
      : null,
  );

  useEffect(() => {
    if (candidate.width != null && candidate.height != null) {
      setDims({ w: candidate.width, h: candidate.height });
      return;
    }

    const img = new Image();
    img.onload = () => {
      setDims({ w: img.naturalWidth, h: img.naturalHeight });
    };
    img.src = candidate.url;

    return () => {
      img.onload = null;
      img.src = "";
    };
  }, [candidate.url, candidate.width, candidate.height]);

  const sizeLabel =
    candidate.fileSize != null && candidate.fileSize > 0
      ? formatBytes(candidate.fileSize)
      : null;
  const dimLabel = dims
    ? formatDimensions(dims.w, dims.h)
    : formatDimensions(candidate.width, candidate.height);

  const meta = [sizeLabel, dimLabel].filter(Boolean).join(" · ");

  return (
    <span className="track-editor__cover-meta">
      {meta || "Loading details…"}
    </span>
  );
}

function TrackEditorField({
  label,
  field,
  type = "text",
  min,
  form,
  tracks,
  isBulk,
  onChange,
  suggestions,
}: {
  label: string;
  field: TrackEditorFormField;
  type?: "text" | "number";
  min?: number;
  form: TrackEditorForm;
  tracks: Track[];
  isBulk: boolean;
  onChange: (field: TrackEditorFormField, value: string) => void;
  suggestions?: string[];
}) {
  const common = {
    type,
    min,
    value: form[field],
    placeholder: isBulk ? mixedFieldPlaceholder(tracks, field, form) : undefined,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      onChange(field, e.target.value),
  };

  return (
    <FormField label={label}>
      {suggestions && type === "text" ? (
        <AutocompleteInput {...common} suggestions={suggestions} />
      ) : (
        <TextInput {...common} />
      )}
    </FormField>
  );
}

export type TrackEditorDetailsTabProps = {
  form: TrackEditorForm;
  tracks: Track[];
  isBulk: boolean;
  referenceTrack: Track | null;
  previewSrc: string | null;
  artDragOver: boolean;
  fetchingArt: boolean;
  fetchMessage: string | null;
  coverCandidates: CoverArtCandidate[];
  selectedCoverUrl: string | null;
  onArtDragOver: (active: boolean) => void;
  onArtDrop: (e: React.DragEvent) => void;
  onChangeArt: () => void;
  onFetchArt: () => void;
  onSelectCover: (url: string) => void;
  onFieldChange: (field: TrackEditorFormField, value: string) => void;
  onRatingChange: (rating: number) => void;
  artistSuggestions: string[];
  genreSuggestions: string[];
  albumSuggestions: string[];
  updateTrackInLibrary: (track: Track) => void;
};

export function TrackEditorDetailsTab({
  form,
  tracks,
  isBulk,
  referenceTrack,
  previewSrc,
  artDragOver,
  fetchingArt,
  fetchMessage,
  coverCandidates,
  selectedCoverUrl,
  onArtDragOver,
  onArtDrop,
  onChangeArt,
  onFetchArt,
  onSelectCover,
  onFieldChange,
  onRatingChange,
  artistSuggestions,
  genreSuggestions,
  albumSuggestions,
  updateTrackInLibrary,
}: TrackEditorDetailsTabProps) {
  const fileSizeBytes = useFileSize(referenceTrack?.filePath);
  const fileExistsOnDisk = useFileExists(referenceTrack?.filePath);
  const isMissingFile =
    referenceTrack != null &&
    (isTrackMissingFile(referenceTrack) || fileExistsOnDisk === false);

  useEffect(() => {
    if (referenceTrack == null || fileExistsOnDisk !== false) {
      return;
    }
    void discoverTrackFileMissing(referenceTrack, updateTrackInLibrary);
  }, [referenceTrack, fileExistsOnDisk, updateTrackInLibrary]);

  return (
    <div className="track-editor__body">
      <div className="track-editor__art-col">
        <div
          data-art-drop-zone
          className={
            artDragOver
              ? "track-editor__art-drop track-editor__art-drop--active"
              : "track-editor__art-drop"
          }
          onDragOver={(e) => {
            e.preventDefault();
            onArtDragOver(true);
          }}
          onDragLeave={() => onArtDragOver(false)}
          onDrop={onArtDrop}
        >
          {previewSrc ? (
            <img src={previewSrc} alt="" className="track-editor__art-img" />
          ) : (
            <EntityArt
              artPath={null}
              className="track-editor__art-placeholder"
            />
          )}
        </div>
        <Button
          size="sm"
          className="track-editor__art-btn"
          onClick={onChangeArt}
        >
          Change Art
        </Button>
        <Button
          size="sm"
          className="track-editor__art-btn"
          onClick={onFetchArt}
          disabled={fetchingArt}
        >
          {fetchingArt ? "Fetching…" : "Fetch Art"}
        </Button>
        {fetchMessage && !fetchingArt && (
          <p className="track-editor__fetch-msg">{fetchMessage}</p>
        )}
        {fetchingArt && (
          <div className="track-editor__fetching" role="status" aria-live="polite">
            <span className="track-editor__fetching-spinner" aria-hidden />
            <span>Fetching artwork…</span>
          </div>
        )}
        {coverCandidates.length > 0 && (
          <div className="track-editor__cover-picker" aria-label="Cover art options">
            {coverCandidates.map((candidate) => {
              const thumbSrc = candidate.thumbnailUrl ?? candidate.url;

              return (
                <button
                  key={candidate.url}
                  type="button"
                  className={
                    selectedCoverUrl === candidate.url
                      ? "track-editor__cover-option track-editor__cover-option--selected"
                      : "track-editor__cover-option"
                  }
                  onClick={() => onSelectCover(candidate.url)}
                  aria-pressed={selectedCoverUrl === candidate.url}
                >
                  <span className="track-editor__cover-thumb">
                    <img src={thumbSrc} alt="" loading="lazy" />
                  </span>
                  <CoverOptionMeta candidate={candidate} />
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="track-editor__fields">
        <TrackEditorField
          label="Title"
          field="title"
          form={form}
          tracks={tracks}
          isBulk={isBulk}
          onChange={onFieldChange}
        />
        <FormField label="Artist">
          <ArtistChipField
            value={form.artist}
            onChange={(value) => onFieldChange("artist", value)}
            placeholder={
              isBulk ? mixedFieldPlaceholder(tracks, "artist", form) : undefined
            }
            suggestions={artistSuggestions}
            inputAriaLabel="Track artist"
          />
        </FormField>
        <TrackEditorField
          label="Album"
          field="album"
          form={form}
          tracks={tracks}
          isBulk={isBulk}
          onChange={onFieldChange}
          suggestions={albumSuggestions}
        />
        <TrackEditorField
          label="Album Artist"
          field="albumArtist"
          form={form}
          tracks={tracks}
          isBulk={isBulk}
          onChange={onFieldChange}
          suggestions={artistSuggestions}
        />
        <TrackEditorField
          label="Year"
          field="year"
          type="number"
          min={1}
          form={form}
          tracks={tracks}
          isBulk={isBulk}
          onChange={onFieldChange}
        />
        <TrackEditorField
          label="Track Number"
          field="trackNumber"
          type="number"
          min={1}
          form={form}
          tracks={tracks}
          isBulk={isBulk}
          onChange={onFieldChange}
        />
        <TrackEditorField
          label="Disc Number"
          field="discNumber"
          type="number"
          min={1}
          form={form}
          tracks={tracks}
          isBulk={isBulk}
          onChange={onFieldChange}
        />
        <TrackEditorField
          label="Genre"
          field="genre"
          form={form}
          tracks={tracks}
          isBulk={isBulk}
          onChange={onFieldChange}
          suggestions={genreSuggestions}
        />
        {!isBulk ? (
          <FormField label="Rating">
            <TrackRating
              value={form.rating}
              size="comfortable"
              onChange={onRatingChange}
            />
          </FormField>
        ) : null}
        {!isBulk && referenceTrack ? (
          <div className="field">
            <FieldLabel>File</FieldLabel>
            {isMissingFile ? (
              <p className="track-editor__file-missing" role="status">
                <IconWarning
                  className="track-editor__file-missing-icon"
                  aria-hidden
                />
                File not found at this location
              </p>
            ) : null}
            <AudioFileSpecs
              className="track-editor__audio-file-specs"
              filePath={referenceTrack.filePath}
              codec={referenceTrack.codec}
              sampleRate={referenceTrack.sampleRate}
              bitrate={referenceTrack.bitrate}
              sizeBytes={fileSizeBytes}
            />
            <div className="track-editor__file-location">
              <textarea
                className={[
                  "track-editor__file-path",
                  isMissingFile && "track-editor__file-path--missing",
                ]
                  .filter(Boolean)
                  .join(" ")}
                readOnly
                value={referenceTrack.filePath}
                rows={1}
                spellCheck={false}
                aria-label="Track file path"
              />
              <Button
                size="sm"
                disabled={isMissingFile}
                aria-label={revealInFileManagerLabel()}
                onClick={() =>
                  void revealTrackInFileManager(
                    referenceTrack,
                    updateTrackInLibrary,
                  )
                }
              >
                Reveal
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
