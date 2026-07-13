import { useEffect } from "react";
import { useFileSize } from "../../hooks/useFileSize";
import { useFileExists } from "../../hooks/useFileExists";
import { revealInFileManagerLabel, revealTrackInFileManager } from "../../lib/fileManager";
import {
  discoverTrackFileMissing,
  isTrackMissingFile,
} from "../../lib/missingFileTrack";
import type { Track } from "../../types/track";
import { AudioFileSpecs } from "../AudioFileSpecs/AudioFileSpecs";
import { Button } from "../common/Button/Button";
import { FieldLabel } from "../common/Field/Field";
import { IconWarning } from "../icons";
import "./TrackEditorFileTab.css";

export type TrackEditorFileTabProps = {
  track: Track;
  updateTrackInLibrary: (track: Track) => void;
};

export function TrackEditorFileTab({
  track,
  updateTrackInLibrary,
}: TrackEditorFileTabProps) {
  const fileSizeBytes = useFileSize(track.filePath);
  const fileExistsOnDisk = useFileExists(track.filePath);
  const isMissingFile =
    isTrackMissingFile(track) || fileExistsOnDisk === false;

  useEffect(() => {
    if (fileExistsOnDisk !== false) {
      return;
    }
    void discoverTrackFileMissing(track, updateTrackInLibrary);
  }, [track, fileExistsOnDisk, updateTrackInLibrary]);

  return (
    <div className="track-editor-file-tab">
      <AudioFileSpecs
        filePath={track.filePath}
        codec={track.codec}
        sampleRate={track.sampleRate}
        bitrate={track.bitrate}
        sizeBytes={fileSizeBytes}
        dateAdded={track.dateAdded}
      />

      <div className="field">
        <FieldLabel>Location</FieldLabel>
        {isMissingFile ? (
          <p className="track-editor__file-missing" role="status">
            <IconWarning
              className="track-editor__file-missing-icon"
              aria-hidden
            />
            File not found at this location
          </p>
        ) : null}
        <div className="track-editor__file-location">
          <textarea
            className={[
              "track-editor__file-path",
              isMissingFile && "track-editor__file-path--missing",
            ]
              .filter(Boolean)
              .join(" ")}
            readOnly
            value={track.filePath}
            rows={1}
            spellCheck={false}
            aria-label="Track file path"
          />
          <Button
            size="sm"
            disabled={isMissingFile}
            aria-label={revealInFileManagerLabel()}
            onClick={() =>
              void revealTrackInFileManager(track, updateTrackInLibrary)
            }
          >
            Reveal
          </Button>
        </div>
      </div>
    </div>
  );
}
