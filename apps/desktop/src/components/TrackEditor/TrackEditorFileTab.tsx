import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useFileSize } from "@/hooks/useFileSize";
import { useFileExists } from "@/hooks/useFileExists";
import { useShortenHomePath } from "@/lib/files/homePath";
import {
  revealInFileManagerLabel,
  revealTrackInFileManager,
} from "@/lib/files/fileManager";
import {
  discoverTrackFileMissing,
  isTrackMissingFile,
} from "@/lib/tracks/missingFileTrack";
import type { Track } from "@/types/track";
import { AudioFileSpecs } from "@/components/AudioFileSpecs/AudioFileSpecs";
import { Button } from "@/components/common/Button/Button";
import { FieldLabel } from "@/components/common/Field/Field";
import { IconWarning } from "@/components/icons";
import "./TrackEditorFileTab.css";

export type TrackEditorFileTabProps = {
  track: Track;
  updateTrackInLibrary: (track: Track) => void;
};

export function TrackEditorFileTab({
  track,
  updateTrackInLibrary,
}: TrackEditorFileTabProps) {
  const { t } = useTranslation(["library", "common"]);
  const displayPath = useShortenHomePath();
  const fileSizeBytes = useFileSize(track.filePath);
  const fileExistsOnDisk = useFileExists(track.filePath);
  const isMissingFile = isTrackMissingFile(track) || fileExistsOnDisk === false;

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
        <FieldLabel>{t("library:editor.fileLocation")}</FieldLabel>
        {isMissingFile ? (
          <p className="track-editor__file-missing" role="status">
            <IconWarning
              className="track-editor__file-missing-icon"
              aria-hidden
            />
            {t("library:editor.fileMissing")}
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
            value={displayPath(track.filePath)}
            title={track.filePath}
            rows={1}
            spellCheck={false}
            aria-label={t("library:editor.filePathAria")}
          />
          <Button
            size="sm"
            disabled={isMissingFile}
            aria-label={revealInFileManagerLabel()}
            onClick={() =>
              void revealTrackInFileManager(track, updateTrackInLibrary)
            }
          >
            {t("common:reveal")}
          </Button>
        </div>
      </div>
    </div>
  );
}
