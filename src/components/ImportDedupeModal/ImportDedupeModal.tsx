import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { audioExtensionFromPath } from "../../lib/supportedAudio";
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

export function ImportDedupeModal() {
  const context = useImportDedupeStore((s) => s.prompt?.context ?? null);
  const resolveImportDedupe = useImportDedupeStore((s) => s.resolveImportDedupe);
  const rejectImportDedupe = useImportDedupeStore((s) => s.rejectImportDedupe);

  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const resolvingRef = useRef(false);
  const [applyToRemaining, setApplyToRemaining] = useState(false);

  const open = context != null;
  useFocusTrap(panelRef, open);

  useEffect(() => {
    if (open) resolvingRef.current = false;
  }, [open]);

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

  const format =
    context != null
      ? audioExtensionFromPath(context.sourcePath).toUpperCase() || "AUDIO"
      : "";

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
            <p className="import-dedupe-modal__meta">
              <span>{format}</span>
              {context.existing.playCount > 0 && (
                <span>
                  {context.existing.playCount}{" "}
                  {context.existing.playCount === 1 ? "play" : "plays"}
                </span>
              )}
            </p>
          </div>
          <p className="import-dedupe-modal__replace-note">
            Replacing this track will still keep play count and playlists
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
