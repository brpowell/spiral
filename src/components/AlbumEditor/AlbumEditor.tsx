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
import {
  albumFormsEqual,
  albumMixedFieldPlaceholder,
  albumToForm,
  buildTrackAlbumMetadata,
  type AlbumEditorForm,
} from "../../lib/albumMetadata";
import {
  albumKey,
  getAlbumByKey,
  groupTracksIntoAlbums,
} from "../../lib/albums";
import { formatBytes, formatDimensions } from "../../lib/formatBytes";
import {
  cacheArtFromFile,
  cacheArtFromUrl,
  fetchCoverArt,
  pickImageFile,
  writeTrackMetadata,
} from "../../lib/tauri";
import { collectGenreSuggestions } from "../../lib/trackFieldSuggestions";
import { useNavigationStore } from "../../store/useNavigationStore";
import { usePlayerStore } from "../../store/usePlayerStore";
import type { CoverArtCandidate } from "../../types/coverArt";
import type { Track } from "../../types/track";
import { EditorSaveButton } from "../EditorSaveButton/EditorSaveButton";
import { EntityArt } from "../EntityArt/EntityArt";
import { EditorDiscardOverlay } from "../EditorDiscardOverlay/EditorDiscardOverlay";
import { AutocompleteInput } from "../common/AutocompleteInput/AutocompleteInput";
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
import "./AlbumEditor.css";

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

export function AlbumEditor() {
  const { t } = useTranslation(["library", "common"]);
  const editingAlbumKey = usePlayerStore((s) => s.editingAlbumKey);
  const library = usePlayerStore((s) => s.library);
  const closeAlbumEditor = usePlayerStore((s) => s.closeAlbumEditor);
  const updateTracksInLibrary = usePlayerStore((s) => s.updateTracksInLibrary);

  const album = useMemo(() => {
    if (!editingAlbumKey) return null;
    const albums = groupTracksIntoAlbums(library);
    return getAlbumByKey(albums, editingAlbumKey) ?? null;
  }, [editingAlbumKey, library]);

  const tracks = album?.tracks ?? [];
  const referenceTrack = tracks[0] ?? null;
  const genreSuggestions = useMemo(
    () => collectGenreSuggestions(library),
    [library],
  );

  const dialogRef = useRef<HTMLDivElement>(null);
  const [form, setForm] = useState<AlbumEditorForm | null>(null);
  const [originalForm, setOriginalForm] = useState<AlbumEditorForm | null>(
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
    requestCancel,
    isCancelled,
    setProgress,
    finish,
  } = useCancellableBulkSave();
  const [fetchingArt, setFetchingArt] = useState(false);
  const [coverCandidates, setCoverCandidates] = useState<CoverArtCandidate[]>(
    [],
  );
  const [selectedCoverUrl, setSelectedCoverUrl] = useState<string | null>(null);
  const [fetchMessage, setFetchMessage] = useState<string | null>(null);
  const [artDragOver, setArtDragOver] = useState(false);

  const isOpen = editingAlbumKey != null && album != null && form != null;

  useFocusTrap(dialogRef, isOpen);

  useEffect(() => {
    if (!album) return;
    const initial = albumToForm(album);
    setForm(initial);
    setOriginalForm(initial);
    setPendingArtPath(album.artPath);
    setOriginalArtPath(album.artPath);
    setArtSourcePath(null);
    setCoverCandidates([]);
    setSelectedCoverUrl(null);
    setFetchMessage(null);
    setSaveError(null);
    setDiscardPrompt(false);
    finish();
    // Reset only when switching albums — full `album` would wipe in-progress edits
    // whenever library data refreshes. setDiscardPrompt is stable useState.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key-gated form reset
  }, [album?.key]);

  const artChanged =
    pendingArtPath !== originalArtPath ||
    selectedCoverUrl != null ||
    artSourcePath != null;

  const hasChanges =
    form != null &&
    originalForm != null &&
    (!albumFormsEqual(form, originalForm) || artChanged);

  const {
    discardPrompt,
    setDiscardPrompt,
    requestClose,
    handleBackdropClick,
    dismissDiscardPrompt,
  } = useEditorDiscardPrompt(hasChanges, closeAlbumEditor, saving);

  const footerCancel = bulkSaveFooterProps({
    saving,
    saveProgress,
    cancelRequested,
    requestCancel,
    requestClose,
    t,
  });

  const setField = (field: keyof AlbumEditorForm, value: string) => {
    setForm((prev) => (prev ? { ...prev, [field]: value } : prev));
  };

  const applyArtPath = async (sourcePath: string) => {
    if (!referenceTrack) return;
    setSaveError(null);
    try {
      const cached = await cacheArtFromFile(
        sourcePath,
        referenceTrack.filePath,
      );
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
    if (!referenceTrack) return;

    const file = e.dataTransfer.files[0];
    if (!file || !file.type.startsWith("image/")) return;

    const path = (file as File & { path?: string }).path;
    if (path) {
      await applyArtPath(path);
      return;
    }

    setSaveError(t("library:editor.dropArtFailed"));
  };

  useArtFileDrop(isOpen && !!referenceTrack, applyArtPath);

  const handleFetchArt = async () => {
    if (!form) return;
    setFetchingArt(true);
    setFetchMessage(null);
    setCoverCandidates([]);
    setSelectedCoverUrl(null);
    setSaveError(null);
    try {
      const candidates = await fetchCoverArt(form.artist, form.title);
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

  const resolveArtPathForTrack = async (
    track: Track,
  ): Promise<string | null> => {
    if (selectedCoverUrl) {
      return (await cacheArtFromUrl(selectedCoverUrl, track.filePath)).path;
    }
    if (artSourcePath) {
      return cacheArtFromFile(artSourcePath, track.filePath);
    }
    return pendingArtPath;
  };

  const handleSave = async () => {
    if (!album || !form || !originalForm || !hasChanges || tracks.length === 0)
      return;
    begin(tracks.length);
    setSaveError(null);

    const updated: Track[] = [];
    const errors: string[] = [];
    const oldKey = album.key;
    let cancelled = false;

    try {
      for (let i = 0; i < tracks.length; i++) {
        if (isCancelled()) {
          cancelled = true;
          break;
        }

        const track = tracks[i];
        setProgress(i + 1, tracks.length);
        try {
          const artPath = artChanged
            ? await resolveArtPathForTrack(track)
            : track.artPath;
          const metadata = buildTrackAlbumMetadata(
            track,
            form,
            originalForm,
            artPath,
            artChanged,
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

      const newKey = albumKey(updated[0]);
      if (useNavigationStore.getState().albumKey === oldKey) {
        useNavigationStore.setState({ albumKey: newKey });
      }
      closeAlbumEditor();
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
      labelledBy="album-editor-title"
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
                  <ModalTitle id="album-editor-title">
                    {t("library:editor.editAlbum")}
                  </ModalTitle>
                  <ModalDescription>
                    {t("library:editor.editAlbumDescription", {
                      count: tracks.length,
                    })}
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
                          ? "track-editor__art-drop track-editor__art-drop--active"
                          : "track-editor__art-drop"
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
                          className="track-editor__art-img"
                        />
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
                        aria-label={t("library:editor.coverOptions")}
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
                    <FormField label={t("library:editor.fields.album")}>
                      <TextInput
                        value={form.title}
                        onChange={(e) => setField("title", e.target.value)}
                      />
                    </FormField>
                    <FormField label={t("library:editor.fields.albumArtist")}>
                      <TextInput
                        value={form.artist}
                        onChange={(e) => setField("artist", e.target.value)}
                      />
                    </FormField>
                    <FormField label={t("library:editor.fields.year")}>
                      <TextInput
                        type="number"
                        value={form.year}
                        onChange={(e) => setField("year", e.target.value)}
                      />
                    </FormField>
                    <FormField label={t("library:editor.fields.genre")}>
                      <AutocompleteInput
                        value={form.genre}
                        placeholder={albumMixedFieldPlaceholder(
                          tracks,
                          "genre",
                          form,
                        )}
                        suggestions={genreSuggestions}
                        onChange={(e) => setField("genre", e.target.value)}
                      />
                    </FormField>
                    <FormField label={t("library:editor.fields.totalTracks")}>
                      <TextInput
                        type="number"
                        min={1}
                        value={form.totalTracks}
                        placeholder={albumMixedFieldPlaceholder(
                          tracks,
                          "totalTracks",
                          form,
                        )}
                        onChange={(e) =>
                          setField("totalTracks", e.target.value)
                        }
                      />
                    </FormField>
                    <FormField label={t("library:editor.fields.totalDiscs")}>
                      <TextInput
                        type="number"
                        min={1}
                        value={form.totalDiscs}
                        placeholder={albumMixedFieldPlaceholder(
                          tracks,
                          "totalDiscs",
                          form,
                        )}
                        onChange={(e) => setField("totalDiscs", e.target.value)}
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
            description={t("library:editor.discardAlbum")}
            onKeepEditing={dismissDiscardPrompt}
            onDiscard={closeAlbumEditor}
          />
        </>
      )}
    </Modal>
  );
}
