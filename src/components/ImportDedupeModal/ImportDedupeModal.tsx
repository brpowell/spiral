import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { formatBytes } from "../../lib/formatBytes";
import { audioExtensionFromPath } from "../../lib/supportedAudio";
import { getFileSize } from "../../lib/tauri";
import type { ImportDedupeAction } from "../../lib/trackDedupe";
import { useImportDedupeStore } from "../../store/useImportDedupeStore";
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

function ImportFileSpecs({
  label,
  filePath,
  sizeBytes,
}: {
  label: string;
  filePath: string;
  sizeBytes: number | null;
}) {
  const format = audioExtensionFromPath(filePath).toUpperCase() || "AUDIO";

  return (
    <div className="import-dedupe-modal__file">
      <span className="import-dedupe-modal__file-label">{label}</span>
      <div className="import-dedupe-modal__file-specs">
        <span className="import-dedupe-modal__format-badge">{format}</span>
        <span className="import-dedupe-modal__size">
          {sizeBytes != null && sizeBytes > 0
            ? formatBytes(sizeBytes)
            : "Size unknown"}
        </span>
      </div>
    </div>
  );
}

export function ImportDedupeModal() {
  const context = useImportDedupeStore((s) => s.prompt?.context ?? null);
  const resolveImportDedupe = useImportDedupeStore((s) => s.resolveImportDedupe);
  const rejectImportDedupe = useImportDedupeStore((s) => s.rejectImportDedupe);

  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const resolvingRef = useRef(false);
  const [applyToRemaining, setApplyToRemaining] = useState(false);
  const [incomingSizeBytes, setIncomingSizeBytes] = useState<number | null>(
    null,
  );
  const [existingSizeBytes, setExistingSizeBytes] = useState<number | null>(
    null,
  );

  const open = context != null;
  useFocusTrap(panelRef, open);

  useEffect(() => {
    if (open) resolvingRef.current = false;
  }, [open]);

  useEffect(() => {
    setIncomingSizeBytes(null);
    setExistingSizeBytes(null);
    if (context == null) return;

    let cancelled = false;

    void (async () => {
      const [incomingSize, existingSize] = await Promise.all([
        getFileSize(context.sourcePath).catch(() => null),
        getFileSize(context.existing.filePath).catch(() => null),
      ]);
      if (cancelled) return;
      setIncomingSizeBytes(incomingSize);
      setExistingSizeBytes(existingSize);
    })();

    return () => {
      cancelled = true;
    };
  }, [context?.sourcePath, context?.existing.filePath]);

  const handleChoice = useCallback(
    async (action: ImportDedupeAction) => {
      if (resolvingRef.current) return;
      resolvingRef.current = true;
      try {
        await resolveImportDedupe(action, applyToRemaining);
        setApplyToRemaining(false);
      } catch (err) {
        console.error("resolveImportDedupe failed:", err);
        resolvingRef.current = false;
      }
    },
    [applyToRemaining, resolveImportDedupe],
  );

  const handleCancelImport = useCallback(() => {
    if (resolvingRef.current) return;
    resolvingRef.current = true;
    rejectImportDedupe();
    setApplyToRemaining(false);
    resolvingRef.current = false;
  }, [rejectImportDedupe]);

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
          <ModalTitle id={titleId}>Duplicate track during import</ModalTitle>
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
            <ImportFileSpecs
              label="Incoming"
              filePath={context.sourcePath}
              sizeBytes={incomingSizeBytes}
            />
            <ImportFileSpecs
              label="In library"
              filePath={context.existing.filePath}
              sizeBytes={existingSizeBytes}
            />
          </div>
          <p className="import-dedupe-modal__replace-note">
            Replacing this file will keep the original play count and playlist
            entries.
          </p>
          {context.remainingDuplicates > 0 && (
            <Checkbox
              variant="muted"
              checked={applyToRemaining}
              onChange={(e) => setApplyToRemaining(e.target.checked)}
            >
              {context.remainingDuplicates === 1
                ? "Apply to remaining duplicate in this import"
                : `Apply to remaining ${context.remainingDuplicates} duplicates in this import`}
            </Checkbox>
          )}
        </ModalBody>
      )}

      <ModalFooter onCancel={handleCancelImport} cancelLabel="Cancel import">
        <Button variant="secondary" onClick={() => void handleChoice("skip")}>
          Skip
        </Button>
        <Button variant="secondary" onClick={() => void handleChoice("import")}>
          Import anyway
        </Button>
        <Button variant="danger" onClick={() => void handleChoice("replace")}>
          Replace
        </Button>
      </ModalFooter>
    </Modal>
  );
}
