import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useFileSize } from "../../hooks/useFileSize";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { t } from "../../lib/i18n";
import { formatLyricsFormatLabel } from "../../lib/lyrics";
import type {
  ImportDedupeAction,
  ImportDedupeResolution,
} from "../../lib/trackDedupe";
import { useImportDedupeStore } from "../../store/useImportDedupeStore";
import type { LyricsFormat } from "../../types/lyrics";
import { AudioFileSpecs } from "../AudioFileSpecs/AudioFileSpecs";
import { Badge } from "../common/Badge/Badge";
import { Button } from "../common/Button/Button";
import { Checkbox } from "../common/Checkbox/Checkbox";
import {
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalHeaderMain,
  ModalTitle,
} from "../common/Modal/Modal";
import "./ImportDedupeModal.css";

function formatTrackSummary(
  title: string,
  artist: string | null,
  album: string | null,
): string {
  const artistAlbum = [artist, album].filter(Boolean).join(" · ");
  return artistAlbum ? `${title} — ${artistAlbum}` : title;
}

function LyricsFormatBadge({ format }: { format: LyricsFormat }) {
  return (
    <Badge variant={format === "plain" ? "neutral" : "accent"}>
      {formatLyricsFormatLabel(format)}
    </Badge>
  );
}

function ImportFileCard({
  label,
  filePath,
  sizeBytes,
  pendingRip = false,
  lyricsFormat = null,
}: {
  label: string;
  filePath?: string;
  sizeBytes?: number | null;
  pendingRip?: boolean;
  lyricsFormat?: LyricsFormat | null;
}) {
  return (
    <div className="import-dedupe-modal__file">
      <span className="import-dedupe-modal__file-label">{label}</span>
      {pendingRip ? (
        <AudioFileSpecs
          formatLabel="FLAC"
          sizeLabel={t("dialogs:importDedupe.notRipped")}
        />
      ) : (
        <AudioFileSpecs filePath={filePath!} sizeBytes={sizeBytes ?? null} />
      )}
      {lyricsFormat != null && (
        <div className="import-dedupe-modal__lyrics">
          <span className="import-dedupe-modal__lyrics-label">
            {t("dialogs:importDedupe.lyrics")}
          </span>
          <LyricsFormatBadge format={lyricsFormat} />
        </div>
      )}
    </div>
  );
}

export function ImportDedupeModal() {
  const context = useImportDedupeStore((s) => s.prompt?.context ?? null);
  const resolveImportDedupe = useImportDedupeStore(
    (s) => s.resolveImportDedupe,
  );
  const rejectImportDedupe = useImportDedupeStore((s) => s.rejectImportDedupe);

  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const resolvingRef = useRef(false);
  const [applyToRemaining, setApplyToRemaining] = useState(false);
  const [replaceLyrics, setReplaceLyrics] = useState(false);
  const incomingSizeBytes = useFileSize(
    context?.incomingPendingRip ? null : context?.sourcePath,
  );
  const existingSizeBytes = useFileSize(context?.existing.filePath);

  const open = context != null;
  useFocusTrap(panelRef, open);

  useEffect(() => {
    if (open) {
      resolvingRef.current = false;
      setReplaceLyrics(false);
    }
  }, [open]);

  const handleChoice = useCallback(
    async (action: ImportDedupeAction) => {
      if (resolvingRef.current) return;
      resolvingRef.current = true;
      try {
        const resolution: ImportDedupeResolution =
          action === "replace" && context?.hasLyricsConflict
            ? { action, replaceLyrics }
            : { action };
        await resolveImportDedupe(resolution, applyToRemaining);
        setApplyToRemaining(false);
        setReplaceLyrics(false);
      } catch (err) {
        console.error("resolveImportDedupe failed:", err);
        resolvingRef.current = false;
      }
    },
    [
      applyToRemaining,
      context?.hasLyricsConflict,
      replaceLyrics,
      resolveImportDedupe,
    ],
  );

  const handleCancelImport = useCallback(() => {
    if (resolvingRef.current) return;
    resolvingRef.current = true;
    rejectImportDedupe();
    setApplyToRemaining(false);
    setReplaceLyrics(false);
    resolvingRef.current = false;
  }, [rejectImportDedupe]);

  const incomingLyricsFormat = context?.incoming.lyrics?.plainText.trim()
    ? (context.incoming.lyrics.format ?? null)
    : null;
  const existingLyricsFormat = context?.existing.lyricsFormat ?? null;

  return (
    <Modal
      open={open}
      onClose={() => {}}
      size="xl"
      panelRef={panelRef}
      labelledBy={titleId}
      dismissible={false}
    >
      <ModalHeader>
        <ModalHeaderMain>
          <ModalTitle id={titleId}>
            {t("dialogs:importDedupe.title")}
          </ModalTitle>
        </ModalHeaderMain>
      </ModalHeader>

      {context != null && (
        <ModalBody>
          <div className="import-dedupe-modal__track">
            <p className="import-dedupe-modal__track-title">
              {formatTrackSummary(
                context.incoming.title,
                context.incoming.artist,
                context.incoming.album,
              )}
            </p>
          </div>
          <div className="import-dedupe-modal__files">
            <ImportFileCard
              label={t("dialogs:importDedupe.incoming")}
              pendingRip={context.incomingPendingRip}
              filePath={context.sourcePath}
              sizeBytes={incomingSizeBytes}
              lyricsFormat={incomingLyricsFormat}
            />
            <ImportFileCard
              label={t("dialogs:importDedupe.inLibrary")}
              filePath={context.existing.filePath}
              sizeBytes={existingSizeBytes}
              lyricsFormat={existingLyricsFormat}
            />
          </div>
          <p className="import-dedupe-modal__replace-note">
            {t("dialogs:importDedupe.replaceNote")}
          </p>
          {(context.hasLyricsConflict || context.remainingDuplicates > 0) && (
            <div className="import-dedupe-modal__options">
              {context.hasLyricsConflict && (
                <Checkbox
                  variant="muted"
                  checked={replaceLyrics}
                  onChange={(e) => setReplaceLyrics(e.target.checked)}
                >
                  {t("dialogs:importDedupe.replaceLyrics")}
                </Checkbox>
              )}
              {context.remainingDuplicates > 0 && (
                <Checkbox
                  variant="muted"
                  checked={applyToRemaining}
                  onChange={(e) => setApplyToRemaining(e.target.checked)}
                >
                  {t("dialogs:importDedupe.applyRemaining", {
                    count: context.remainingDuplicates,
                  })}
                </Checkbox>
              )}
            </div>
          )}
        </ModalBody>
      )}

      <ModalFooter
        onCancel={handleCancelImport}
        cancelLabel={t("dialogs:importDedupe.cancelImport")}
      >
        <Button variant="secondary" onClick={() => void handleChoice("skip")}>
          {t("dialogs:importDedupe.skip")}
        </Button>
        <Button variant="secondary" onClick={() => void handleChoice("import")}>
          {t("dialogs:importDedupe.importAnyway")}
        </Button>
        <Button variant="danger" onClick={() => void handleChoice("replace")}>
          {t("dialogs:importDedupe.replace")}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
