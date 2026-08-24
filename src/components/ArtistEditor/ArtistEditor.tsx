import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useArtFileDrop } from "../../hooks/useArtFileDrop";
import { useAssetUrl } from "../../hooks/useAssetUrl";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useEditorDiscardPrompt } from "../../hooks/useEditorDiscardPrompt";
import {
  bulkSaveFooterProps,
  bulkSaveLabel,
  useCancellableBulkSave,
} from "../../hooks/useCancellableBulkSave";
import { artistArtCacheKey, applyArtistImages } from "../../lib/artistArt";
import { t as translate } from "../../lib/i18n";
import {
  artistFormsEqual,
  artistKeyAfterRename,
  artistToForm,
  buildTrackArtistMetadata,
  type ArtistEditorForm,
} from "../../lib/artistMetadata";
import { getArtistByKey, groupTracksIntoArtists } from "../../lib/artists";
import { formatBytes, formatDimensions } from "../../lib/formatBytes";
import {
  cacheArtFromFile,
  cacheArtFromUrl,
  fetchArtistArt,
  pickImageFile,
  writeTrackMetadata,
} from "../../lib/tauri";
import { useArtistImageStore } from "../../store/useArtistImageStore";
import { useNavigationStore } from "../../store/useNavigationStore";
import { usePlayerStore } from "../../store/usePlayerStore";
import type { CoverArtCandidate } from "../../types/coverArt";
import type { Track } from "../../types/track";
import { EntityArt } from "../EntityArt/EntityArt";
import { EditorSaveButton } from "../EditorSaveButton/EditorSaveButton";
import { EditorDiscardOverlay } from "../EditorDiscardOverlay/EditorDiscardOverlay";
import { IconArtistPlaceholder } from "../icons";
import {
  Modal,
  ModalBody,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalHeaderMain,
  ModalTitle,
} from "../common/Modal/Modal";
import { Button } from "../common/Button/Button";
import { FormField } from "../common/Field/Field";
import { TextInput } from "../common/TextInput/TextInput";
import "../TrackEditor/TrackEditor.css";

function CoverOptionMeta({ candidate }: { candidate: CoverArtCandidate }) {
  const { t } = useTranslation("library");
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
      {meta || t("editor.loadingDetails")}
    </span>
  );
}

export function ArtistEditor() {
  const { t } = useTranslation(["library", "common"]);
  const editingArtistKey = usePlayerStore((s) => s.editingArtistKey);
  const editingArtistBrowseMode = usePlayerStore(
    (s) => s.editingArtistBrowseMode,
  );
  const library = usePlayerStore((s) => s.library);
  const closeArtistEditor = usePlayerStore((s) => s.closeArtistEditor);
  const updateTracksInLibrary = usePlayerStore((s) => s.updateTracksInLibrary);
  const imagesByKey = useArtistImageStore((s) => s.imagesByKey);
  const saveArtistImage = useArtistImageStore((s) => s.saveArtistImage);
  const renameArtistImageKey = useArtistImageStore(
    (s) => s.renameArtistImageKey,
  );

  const artist = useMemo(() => {
    if (!editingArtistKey) return null;
    const artists = groupTracksIntoArtists(library, editingArtistBrowseMode);
    const withImages = applyArtistImages(artists, imagesByKey);
    return getArtistByKey(withImages, editingArtistKey) ?? null;
  }, [editingArtistKey, editingArtistBrowseMode, library, imagesByKey]);

  const tracks = artist?.tracks ?? [];

  const dialogRef = useRef<HTMLDivElement>(null);
  const [form, setForm] = useState<ArtistEditorForm | null>(null);
  const [originalForm, setOriginalForm] = useState<ArtistEditorForm | null>(
    null,
  );
  const [pendingArtPath, setPendingArtPath] = useState<string | null>(null);
  const [originalArtPath, setOriginalArtPath] = useState<string | null>(null);
  const [artSourcePath, setArtSourcePath] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const {
    saving,
    saveProgress,
    cancelRequested,
    begin,
    beginQuick,
    requestCancel,
    isCancelled,
    setProgress,
    enterQuickPhase,
    finish,
  } = useCancellableBulkSave();
  const [fetchingArt, setFetchingArt] = useState(false);
  const [coverCandidates, setCoverCandidates] = useState<CoverArtCandidate[]>(
    [],
  );
  const [selectedCoverUrl, setSelectedCoverUrl] = useState<string | null>(null);
  const [fetchMessage, setFetchMessage] = useState<string | null>(null);
  const [artDragOver, setArtDragOver] = useState(false);

  const isOpen = editingArtistKey != null && artist != null && form != null;

  useFocusTrap(dialogRef, isOpen);

  useEffect(() => {
    if (!artist) return;
    const initial = artistToForm(artist);
    setForm(initial);
    setOriginalForm(initial);
    setPendingArtPath(artist.artPath);
    setOriginalArtPath(artist.artPath);
    setArtSourcePath(null);
    setCoverCandidates([]);
    setSelectedCoverUrl(null);
    setFetchMessage(null);
    setSaveError(null);
    setDiscardPrompt(false);
    finish();
    // Reset only when switching artists — full `artist` would wipe in-progress edits
    // whenever library data refreshes. setDiscardPrompt is stable useState.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key-gated form reset
  }, [artist?.key]);

  const artChanged =
    pendingArtPath !== originalArtPath ||
    selectedCoverUrl != null ||
    artSourcePath != null;

  const hasChanges =
    form != null &&
    originalForm != null &&
    (!artistFormsEqual(form, originalForm) || artChanged);

  const {
    discardPrompt,
    setDiscardPrompt,
    requestClose,
    handleBackdropClick,
    dismissDiscardPrompt,
  } = useEditorDiscardPrompt(hasChanges, closeArtistEditor, saving);

  const footerCancel = bulkSaveFooterProps({
    saving,
    saveProgress,
    cancelRequested,
    requestCancel,
    requestClose,
    t,
  });

  const artCacheKey = editingArtistKey
    ? artistArtCacheKey(editingArtistKey)
    : null;

  const applyArtPath = async (sourcePath: string) => {
    if (!artCacheKey) return;
    setSaveError(null);
    try {
      const cached = await cacheArtFromFile(sourcePath, artCacheKey);
      setArtSourcePath(sourcePath);
      setSelectedCoverUrl(null);
      setPendingArtPath(cached);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSaveError(message);
    }
  };

  const handleChangeArt = async () => {
    const path = await pickImageFile();
    if (path) await applyArtPath(path);
  };

  const handleArtDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setArtDragOver(false);
    if (!artCacheKey) return;

    const file = e.dataTransfer.files[0];
    if (!file || !file.type.startsWith("image/")) return;

    const path = (file as File & { path?: string }).path;
    if (path) {
      await applyArtPath(path);
      return;
    }

    setSaveError(t("library:editor.dropArtFailed"));
  };

  useArtFileDrop(isOpen && !!artCacheKey, applyArtPath);

  const handleFetchArt = async () => {
    if (!form) return;
    setFetchingArt(true);
    setFetchMessage(null);
    setCoverCandidates([]);
    setSelectedCoverUrl(null);
    setSaveError(null);
    try {
      const candidates = await fetchArtistArt(form.name);
      if (candidates.length === 0) {
        setFetchMessage(t("library:editor.noArtResults"));
      } else {
        setCoverCandidates(candidates);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSaveError(message);
    } finally {
      setFetchingArt(false);
    }
  };

  const handleSelectCover = (url: string) => {
    setSaveError(null);
    setSelectedCoverUrl(url);
    setArtSourcePath(null);
  };

  const resolveArtistArtPath = async (
    cacheKey: string,
  ): Promise<string | null> => {
    if (selectedCoverUrl) {
      return (await cacheArtFromUrl(selectedCoverUrl, cacheKey)).path;
    }
    if (artSourcePath) {
      return cacheArtFromFile(artSourcePath, cacheKey);
    }
    return pendingArtPath;
  };

  const handleSave = async () => {
    if (!artist || !form || !originalForm || !hasChanges || !editingArtistKey) {
      return;
    }

    const oldKey = editingArtistKey;
    const browseMode = editingArtistBrowseMode;
    const newKey = artistKeyAfterRename(form.name, browseMode);
    const nameChanged = form.name !== originalForm.name;

    if (nameChanged && tracks.length === 0) return;

    const updated: Track[] = [];
    const errors: string[] = [];
    let cancelled = false;

    if (nameChanged) {
      begin(tracks.length);
    } else {
      beginQuick();
    }
    setSaveError(null);

    try {
      if (nameChanged) {
        for (let i = 0; i < tracks.length; i++) {
          if (isCancelled()) {
            cancelled = true;
            break;
          }

          const track = tracks[i];
          setProgress(i + 1, tracks.length);
          try {
            const metadata = buildTrackArtistMetadata(
              track,
              form,
              originalForm,
              oldKey,
              browseMode,
            );
            const saved = await writeTrackMetadata(
              track.id,
              track.filePath,
              metadata,
            );
            updated.push(saved);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            errors.push(`${track.title}: ${message}`);
          }
        }

        if (updated.length > 0) {
          updateTracksInLibrary(updated);
        }

        if (cancelled) {
          setSaveError(
            t("library:editor.saveCancelled", {
              updated: updated.length,
              total: tracks.length,
            }),
          );
          return;
        }

        if (errors.length > 0) {
          setSaveError(
            errors.length === tracks.length
              ? errors[0]
              : t("library:editor.partialSave", {
                  updated: updated.length,
                  total: tracks.length,
                  error: errors[0],
                }),
          );
          return;
        }

        if (oldKey !== newKey && !artChanged) {
          await renameArtistImageKey(oldKey, newKey, browseMode);
        }
      }

      if (artChanged) {
        enterQuickPhase();
        const cacheKey = artistArtCacheKey(newKey);
        const finalArtPath = await resolveArtistArtPath(cacheKey);
        await saveArtistImage(newKey, browseMode, finalArtPath);
        if (nameChanged && oldKey !== newKey) {
          await saveArtistImage(oldKey, browseMode, null);
        }
      }

      if (useNavigationStore.getState().artistKey === oldKey) {
        useNavigationStore.setState({ artistKey: newKey });
      }
      closeArtistEditor();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSaveError(message);
    } finally {
      finish();
    }
  };

  const displayArtSrc = useAssetUrl(selectedCoverUrl ? null : pendingArtPath);
  const previewSrc = selectedCoverUrl ?? displayArtSrc;

  const saveLabel = bulkSaveLabel(saving, saveProgress, t);

  return (
    <Modal
      open={isOpen}
      onClose={handleBackdropClick}
      dismissible={!saving}
      size="editor"
      panelClassName="track-editor-modal"
      panelRef={dialogRef}
      labelledBy="artist-editor-title"
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
                  <ModalTitle id="artist-editor-title">
                    {t("library:editor.editArtist")}
                  </ModalTitle>
                  <ModalDescription>
                    {nameChangedDescription(
                      form!,
                      originalForm!,
                      tracks.length,
                      artChanged,
                    )}
                  </ModalDescription>
                </ModalHeaderMain>
              </ModalHeader>

              <ModalBody>
                <div className="track-editor__body">
                  <div className="track-editor__art-col">
                    <div
                      data-art-drop-zone
                      className={
                        artDragOver
                          ? "track-editor__art-drop track-editor__art-drop--active track-editor__art-drop--round"
                          : "track-editor__art-drop track-editor__art-drop--round"
                      }
                      onDragOver={(e) => {
                        e.preventDefault();
                        setArtDragOver(true);
                      }}
                      onDragLeave={() => setArtDragOver(false)}
                      onDrop={handleArtDrop}
                    >
                      {previewSrc ? (
                        <img
                          src={previewSrc}
                          alt=""
                          className="track-editor__art-img track-editor__art-img--round"
                        />
                      ) : (
                        <EntityArt
                          artPath={null}
                          className="track-editor__art-placeholder album-art--round"
                          placeholder={<IconArtistPlaceholder />}
                        />
                      )}
                    </div>
                    <Button
                      size="sm"
                      className="track-editor__art-btn"
                      onClick={() => void handleChangeArt()}
                    >
                      {t("library:editor.addArt")}
                    </Button>
                    <Button
                      size="sm"
                      className="track-editor__art-btn"
                      onClick={() => void handleFetchArt()}
                      disabled={fetchingArt}
                    >
                      {fetchingArt
                        ? t("library:editor.fetchingArt")
                        : t("library:editor.fetchArt")}
                    </Button>
                    {fetchMessage && !fetchingArt && (
                      <p className="track-editor__fetch-msg">{fetchMessage}</p>
                    )}
                    {fetchingArt && (
                      <div
                        className="track-editor__fetching"
                        role="status"
                        aria-live="polite"
                      >
                        <span
                          className="track-editor__fetching-spinner"
                          aria-hidden
                        />
                        <span>{t("library:editor.fetchingArtStatus")}</span>
                      </div>
                    )}
                    {coverCandidates.length > 0 && (
                      <div
                        className="track-editor__cover-picker"
                        aria-label={t("library:editor.artistImageOptions")}
                      >
                        {coverCandidates.map((candidate) => {
                          const thumbSrc =
                            candidate.thumbnailUrl ?? candidate.url;

                          return (
                            <button
                              key={candidate.url}
                              type="button"
                              className={
                                selectedCoverUrl === candidate.url
                                  ? "track-editor__cover-option track-editor__cover-option--selected"
                                  : "track-editor__cover-option"
                              }
                              onClick={() => handleSelectCover(candidate.url)}
                              aria-pressed={selectedCoverUrl === candidate.url}
                            >
                              <span className="track-editor__cover-thumb track-editor__cover-thumb--round">
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
                    <FormField label={t("library:editor.fields.artist")}>
                      <TextInput
                        value={form.name}
                        onChange={(e) =>
                          setForm((prev) =>
                            prev ? { ...prev, name: e.target.value } : prev,
                          )
                        }
                      />
                    </FormField>
                  </div>
                </div>

                {saveError && (
                  <p className="track-editor__error" role="alert">
                    {saveError}
                  </p>
                )}
              </ModalBody>
            </div>

            <ModalFooter inert={discardPrompt || undefined} {...footerCancel}>
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
            description={t("library:editor.discardArtist")}
            onKeepEditing={dismissDiscardPrompt}
            onDiscard={closeArtistEditor}
          />
        </>
      )}
    </Modal>
  );
}

function nameChangedDescription(
  form: ArtistEditorForm,
  originalForm: ArtistEditorForm,
  trackCount: number,
  artChanged: boolean,
): string {
  const nameChanged = form.name !== originalForm.name;
  if (nameChanged && artChanged) {
    return translate("library:editor.artistRenameWithArt", {
      count: trackCount,
    });
  }
  if (nameChanged) {
    return translate("library:editor.artistRenameDescription", {
      count: trackCount,
    });
  }
  return translate("library:editor.artistImagesNote");
}
