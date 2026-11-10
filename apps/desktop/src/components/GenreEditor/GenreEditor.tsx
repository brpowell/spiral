import { useEffect, useMemo, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { EditorDiscardOverlay } from "@/components/EditorDiscardOverlay/EditorDiscardOverlay";
import { EditorSaveButton } from "@/components/EditorSaveButton/EditorSaveButton";
import { FormField } from "@/components/common/Field/Field";
import {
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalHeaderMain,
  ModalTitle,
} from "@/components/common/Modal/Modal";
import { IconWarning } from "@/components/icons";
import { Alert } from "@/components/common/Alert/Alert";
import { AutocompleteInput } from "@/components/common/AutocompleteInput/AutocompleteInput";
import { useEditorDiscardPrompt } from "@/hooks/useEditorDiscardPrompt";
import {
  bulkSaveFooterProps,
  bulkSaveLabel,
  useCancellableBulkSave,
} from "@/hooks/useCancellableBulkSave";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { describeSourceError } from "@/lib/files/sourceAccess";
import { buildTrackGenreMetadata } from "@/lib/genres/genreMetadata";
import {
  findMergeTarget,
  genreRenameNeeded,
  getGenreByKey,
  groupTracksIntoGenres,
  normalizeGenreName,
} from "@/lib/genres/genres";
import { collectGenreSuggestions } from "@/lib/tracks/trackFieldSuggestions";
import { writeTrackMetadata } from "@/lib/tauri";
import { showTagWriteSavedToast } from "@/lib/tracks/trackMetadataToast";
import { useNavigationStore } from "@/store/useNavigationStore";
import { usePlayerStore } from "@/store/usePlayerStore";
import { useTagWriteConfirmStore } from "@/store/useTagWriteConfirmStore";
import type { Track } from "@/types/track";
import "@/components/TrackEditor/TrackEditor.css";

/** Rename a genre by rewriting the genre tag on every track that carries it. */
export function GenreEditor() {
  const { t } = useTranslation(["library", "common"]);
  const editingGenreKey = usePlayerStore((s) => s.editingGenreKey);
  const library = usePlayerStore((s) => s.library);
  const closeGenreEditor = usePlayerStore((s) => s.closeGenreEditor);
  const updateTracksInLibrary = usePlayerStore((s) => s.updateTracksInLibrary);

  const allGenres = useMemo(() => groupTracksIntoGenres(library), [library]);
  const genre = useMemo(
    () =>
      editingGenreKey ? getGenreByKey(allGenres, editingGenreKey) : undefined,
    [editingGenreKey, allGenres],
  );

  // Other genres in the library, so typing one merges this genre into it.
  const suggestions = useMemo(
    () =>
      collectGenreSuggestions(library).filter(
        (name) => name.toLowerCase() !== editingGenreKey,
      ),
    [library, editingGenreKey],
  );

  const dialogRef = useRef<HTMLDivElement>(null);
  const [name, setName] = useState("");
  const mergeTarget = genre
    ? findMergeTarget(allGenres, genre.key, name)
    : undefined;
  const [saveError, setSaveError] = useState<string | null>(null);
  const {
    saving,
    saveProgress,
    cancelRequested,
    begin,
    requestCancel,
    isCancelled,
    setProgress,
    finish,
  } = useCancellableBulkSave();

  const isOpen = editingGenreKey != null && genre != null;
  useFocusTrap(dialogRef, isOpen);

  // Reset only when switching genres, so a library refresh cannot wipe an edit.
  useEffect(() => {
    setName(genre?.name ?? "");
    setSaveError(null);
    setDiscardPrompt(false);
    finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key-gated form reset
  }, [genre?.key]);

  const hasChanges =
    genre != null &&
    normalizeGenreName(name) != null &&
    genreRenameNeeded(genre, name);

  const {
    discardPrompt,
    setDiscardPrompt,
    requestClose,
    handleBackdropClick,
    dismissDiscardPrompt,
  } = useEditorDiscardPrompt(hasChanges, closeGenreEditor, saving);

  const footerCancel = bulkSaveFooterProps({
    saving,
    saveProgress,
    cancelRequested,
    requestCancel,
    requestClose,
    t,
  });

  const handleSave = async () => {
    const nextName = normalizeGenreName(name);
    if (!genre || !nextName || !hasChanges) return;

    const targets = genre.tracks.filter(
      (track) => (track.genre?.trim() ?? "") !== nextName,
    );
    const confirmed = await useTagWriteConfirmStore
      .getState()
      .confirmTagWrite("genre", targets.length);
    if (!confirmed) return;

    const oldKey = genre.key;
    const updated: Track[] = [];
    const errors: string[] = [];
    let cancelled = false;

    begin(targets.length);
    setSaveError(null);
    try {
      for (let i = 0; i < targets.length; i++) {
        if (isCancelled()) {
          cancelled = true;
          break;
        }
        const track = targets[i];
        setProgress(i + 1, targets.length);
        try {
          updated.push(
            await writeTrackMetadata(
              track.id,
              track.filePath,
              buildTrackGenreMetadata(track, nextName),
            ),
          );
        } catch (err) {
          errors.push(`${track.title}: ${describeSourceError(err)}`);
        }
      }

      if (updated.length > 0) updateTracksInLibrary(updated);

      if (cancelled) {
        setSaveError(
          t("library:editor.saveCancelled", {
            updated: updated.length,
            total: targets.length,
          }),
        );
        return;
      }
      if (errors.length > 0) {
        setSaveError(
          errors.length === targets.length
            ? errors[0]
            : t("library:editor.partialSave", {
                updated: updated.length,
                total: targets.length,
                error: errors[0],
              }),
        );
        return;
      }

      showTagWriteSavedToast(updated.length);

      // Keep the detail view on the renamed genre instead of bouncing to the list.
      const nav = useNavigationStore.getState();
      if (nav.genreKey === oldKey) {
        nav.openGenre(nextName.toLowerCase(), nextName);
      }
      closeGenreEditor();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      finish();
    }
  };

  const saveLabel = bulkSaveLabel(saving, saveProgress, t);

  return (
    <Modal
      open={isOpen}
      onClose={handleBackdropClick}
      dismissible={!saving}
      size="editor"
      fitContent
      panelClassName="track-editor-modal track-editor-modal--compact"
      panelRef={dialogRef}
      labelledBy="genre-editor-title"
    >
      {isOpen && (
        <>
          <div className="track-editor-modal__content">
            <div
              className="track-editor-modal__main"
              inert={discardPrompt || saving || undefined}
            >
              <ModalHeader>
                <ModalHeaderMain>
                  <ModalTitle id="genre-editor-title">
                    {t("library:actions.editGenre")}
                  </ModalTitle>
                </ModalHeaderMain>
              </ModalHeader>

              <ModalBody>
                <div className="track-editor__fields">
                  <FormField label={t("library:editor.fields.genre")}>
                    <AutocompleteInput
                      value={name}
                      suggestions={suggestions}
                      autoFocus
                      onChange={(e) => setName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void handleSave();
                        }
                      }}
                    />
                  </FormField>
                  {mergeTarget ? (
                    <Alert variant="warning" icon={<IconWarning />}>
                      <Trans
                        i18nKey="editor.genreMergeWarning"
                        ns="library"
                        count={genre.tracks.length}
                        values={{ name: mergeTarget.name }}
                        components={{ strong: <strong /> }}
                      />
                    </Alert>
                  ) : null}
                </div>
                {saveError && (
                  <p className="track-editor__error" role="alert">
                    {saveError}
                  </p>
                )}
              </ModalBody>
            </div>

            <ModalFooter
              fade
              inert={discardPrompt || undefined}
              {...footerCancel}
            >
              <EditorSaveButton
                saving={saving}
                label={saveLabel}
                onClick={() => void handleSave()}
                disabled={!hasChanges || saving || discardPrompt}
              />
            </ModalFooter>
          </div>

          <EditorDiscardOverlay
            open={discardPrompt}
            description={t("library:editor.discardGenre")}
            onKeepEditing={dismissDiscardPrompt}
            onDiscard={closeGenreEditor}
          />
        </>
      )}
    </Modal>
  );
}
