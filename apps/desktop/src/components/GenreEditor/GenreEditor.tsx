import { useEffect, useMemo, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { EditorDiscardOverlay } from "@/components/EditorDiscardOverlay/EditorDiscardOverlay";
import { EditorSaveButton } from "@/components/EditorSaveButton/EditorSaveButton";
import { FormField } from "@/components/common/Field/Field";
import { Tab, TabList, TabPanel, Tabs } from "@/components/common/Tabs/Tabs";
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
import { useResetOnOpen } from "@/hooks/useResetOnOpen";
import { describeSourceError } from "@/lib/files/sourceAccess";
import {
  defaultDesignForGenre,
  genreDesignsEqual,
  type GenreDesign,
} from "@/lib/genres/genreDesign";
import { buildTrackGenreMetadata } from "@/lib/genres/genreMetadata";
import {
  type Genre,
  findMergeTarget,
  genreRenameNeeded,
  getGenreByKey,
  groupTracksIntoGenres,
  normalizeGenreName,
} from "@/lib/genres/genres";
import { collectGenreSuggestions } from "@/lib/tracks/trackFieldSuggestions";
import { writeTrackMetadata } from "@/lib/tauri";
import { showTagWriteSavedToast } from "@/lib/tracks/trackMetadataToast";
import {
  useGenreDesign,
  useGenreDesignStore,
} from "@/store/useGenreDesignStore";
import { useNavigationStore } from "@/store/useNavigationStore";
import { usePlayerStore } from "@/store/usePlayerStore";
import { useTagWriteConfirmStore } from "@/store/useTagWriteConfirmStore";
import type { Track } from "@/types/track";
import "@/components/TrackEditor/TrackEditor.css";
import { GenreArtTab } from "./GenreArtTab";
import "./GenreEditor.css";

type GenreEditorTab = "details" | "art";

/**
 * Edit a genre: rename it by rewriting the genre tag on every track that
 * carries it, and optionally give it a designed look.
 */
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
  const [activeTab, setActiveTab] = useState<GenreEditorTab>("details");
  const [design, setDesign] = useState<GenreDesign | null>(null);
  const [applyToAll, setApplyToAll] = useState(false);
  const originalDesign = useGenreDesign(editingGenreKey ?? "");
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
  useResetOnOpen(isOpen, "details", activeTab, setActiveTab);

  // Reset only when switching genres, so a library refresh cannot wipe an edit.
  useEffect(() => {
    setName(genre?.name ?? "");
    setDesign(
      genre
        ? (useGenreDesignStore.getState().designs[genre.key] ??
            defaultDesignForGenre(genre.key))
        : null,
    );
    setApplyToAll(false);
    setSaveError(null);
    setDiscardPrompt(false);
    finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key-gated form reset
  }, [genre?.key]);

  const nameChanged = genre != null && genreRenameNeeded(genre, name);
  const designChanged =
    design != null && !genreDesignsEqual(design, originalDesign);
  const hasChanges =
    genre != null &&
    normalizeGenreName(name) != null &&
    (nameChanged || designChanged || applyToAll);

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

  /** Write the new name to every track that differs. False if it didn't finish. */
  const writeGenreTags = async (
    source: Genre,
    nextName: string,
  ): Promise<boolean> => {
    const targets = source.tracks.filter(
      (track) => (track.genre?.trim() ?? "") !== nextName,
    );
    const confirmed = await useTagWriteConfirmStore
      .getState()
      .confirmTagWrite("genre", targets.length);
    if (!confirmed) return false;

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
        return false;
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
        return false;
      }

      showTagWriteSavedToast(updated.length);
      return true;
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      finish();
    }
  };

  const handleSave = async () => {
    const nextName = normalizeGenreName(name);
    if (!genre || !nextName || !hasChanges) return;

    const oldKey = genre.key;
    const newKey = nextName.toLowerCase();

    if (nameChanged && !(await writeGenreTags(genre, nextName))) return;

    // The look follows the genre across a rename or merge, then any edit to it.
    // Only a design that differs from the genre's generated one is kept.
    const designs = useGenreDesignStore.getState();
    designs.renameKey(oldKey, newKey);
    const isGeneratedLook =
      design != null &&
      genreDesignsEqual(design, defaultDesignForGenre(newKey));
    if (applyToAll && design) {
      // Every genre, this one under its new name. Starting from the generated
      // look means "reset": each genre goes back to its own.
      const keys = new Set(
        allGenres.map((g) => (g.key === oldKey ? newKey : g.key)),
      );
      designs.applyToAll([...keys], isGeneratedLook ? null : design);
    } else if (designChanged) {
      designs.setDesign(newKey, isGeneratedLook ? null : design);
    }

    // Keep the detail view on the renamed genre instead of bouncing to the list.
    const nav = useNavigationStore.getState();
    if (nav.genreKey === oldKey) nav.openGenre(newKey, nextName);
    closeGenreEditor();
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
          <div className="track-editor-modal__content track-editor-modal__content--tabbed">
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

              <Tabs
                value={activeTab}
                onChange={(tab) => setActiveTab(tab as GenreEditorTab)}
                className="track-editor__tabs"
                variant="underline"
              >
                <TabList
                  fade
                  aria-label={t("library:editor.genreTabsAria")}
                  className="track-editor__tab-bar"
                >
                  <Tab value="details">{t("library:editor.tabDetails")}</Tab>
                  <Tab value="art">{t("library:editor.tabArt")}</Tab>
                </TabList>

                <ModalBody className="track-editor__tab-body">
                  <div className="track-editor__tab-stage">
                    <TabPanel
                      value="details"
                      className="track-editor__tab-panel"
                    >
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
                    </TabPanel>

                    <TabPanel value="art" className="track-editor__tab-panel">
                      {design ? (
                        <GenreArtTab
                          genre={genre}
                          design={design}
                          onChange={setDesign}
                          applyToAll={applyToAll}
                          onApplyToAllChange={setApplyToAll}
                        />
                      ) : null}
                    </TabPanel>
                  </div>

                  {saveError && (
                    <p className="track-editor__error" role="alert">
                      {saveError}
                    </p>
                  )}
                </ModalBody>
              </Tabs>
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
