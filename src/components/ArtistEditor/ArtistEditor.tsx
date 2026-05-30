import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAssetUrl } from "../../hooks/useAssetUrl";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { artistArtCacheKey, applyArtistImages } from "../../lib/artistArt";
import {
  artistFormsEqual,
  artistKeyAfterRename,
  artistToForm,
  buildTrackArtistMetadata,
  type ArtistEditorForm,
} from "../../lib/artistMetadata";
import {
  getArtistByKey,
  groupTracksIntoArtists,
} from "../../lib/artists";
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
import { IconArtistPlaceholder } from "../icons";
import {
  Modal,
  ModalBody,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from "../common/Modal/Modal";
import { Button } from "../common/Button/Button";
import { FormField } from "../common/Field/Field";
import { TextInput } from "../common/TextInput/TextInput";
import "../TrackEditor/TrackEditor.css";

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

export function ArtistEditor() {
  const editingArtistKey = usePlayerStore((s) => s.editingArtistKey);
  const editingArtistBrowseMode = usePlayerStore(
    (s) => s.editingArtistBrowseMode,
  );
  const library = usePlayerStore((s) => s.library);
  const closeArtistEditor = usePlayerStore((s) => s.closeArtistEditor);
  const updateTracksInLibrary = usePlayerStore((s) => s.updateTracksInLibrary);
  const imagesByKey = useArtistImageStore((s) => s.imagesByKey);
  const saveArtistImage = useArtistImageStore((s) => s.saveArtistImage);
  const renameArtistImageKey = useArtistImageStore((s) => s.renameArtistImageKey);

  const artist = useMemo(() => {
    if (!editingArtistKey) return null;
    const artists = groupTracksIntoArtists(library, editingArtistBrowseMode);
    const withImages = applyArtistImages(
      artists,
      imagesByKey,
    );
    return getArtistByKey(withImages, editingArtistKey) ?? null;
  }, [editingArtistKey, editingArtistBrowseMode, library, imagesByKey]);

  const tracks = artist?.tracks ?? [];

  const dialogRef = useRef<HTMLDivElement>(null);
  const [form, setForm] = useState<ArtistEditorForm | null>(null);
  const [originalForm, setOriginalForm] = useState<ArtistEditorForm | null>(null);
  const [pendingArtPath, setPendingArtPath] = useState<string | null>(null);
  const [originalArtPath, setOriginalArtPath] = useState<string | null>(null);
  const [artSourcePath, setArtSourcePath] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
  const [fetchingArt, setFetchingArt] = useState(false);
  const [coverCandidates, setCoverCandidates] = useState<CoverArtCandidate[]>([]);
  const [selectedCoverUrl, setSelectedCoverUrl] = useState<string | null>(null);
  const [fetchMessage, setFetchMessage] = useState<string | null>(null);
  const [artDragOver, setArtDragOver] = useState(false);
  const [discardPrompt, setDiscardPrompt] = useState(false);

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
    setSaveProgress(null);
  }, [artist?.key]);

  const artChanged =
    pendingArtPath !== originalArtPath ||
    selectedCoverUrl != null ||
    artSourcePath != null;

  const hasChanges =
    form != null &&
    originalForm != null &&
    (!artistFormsEqual(form, originalForm) || artChanged);

  const requestClose = useCallback(() => {
    if (hasChanges) {
      setDiscardPrompt(true);
      return;
    }
    closeArtistEditor();
  }, [hasChanges, closeArtistEditor]);

  const handleBackdropClick = useCallback(() => {
    requestClose();
  }, [requestClose]);

  const handleCancel = () => {
    if (discardPrompt) {
      setDiscardPrompt(false);
      return;
    }
    requestClose();
  };

  const confirmDiscard = () => {
    setDiscardPrompt(false);
    closeArtistEditor();
  };

  useEffect(() => {
    if (editingArtistKey == null) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (discardPrompt) {
        setDiscardPrompt(false);
        return;
      }
      if (hasChanges) {
        setDiscardPrompt(true);
        return;
      }
      closeArtistEditor();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editingArtistKey, hasChanges, discardPrompt, closeArtistEditor]);

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

    setSaveError("Could not read the dropped image path.");
  };

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
        setFetchMessage("No results found");
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

  const resolveArtistArtPath = async (cacheKey: string): Promise<string | null> => {
    if (selectedCoverUrl) {
      return cacheArtFromUrl(selectedCoverUrl, cacheKey);
    }
    if (artSourcePath) {
      return cacheArtFromFile(artSourcePath, cacheKey);
    }
    return pendingArtPath;
  };

  const handleSave = async () => {
    if (
      !artist ||
      !form ||
      !originalForm ||
      !hasChanges ||
      !editingArtistKey
    ) {
      return;
    }

    const oldKey = editingArtistKey;
    const browseMode = editingArtistBrowseMode;
    const newKey = artistKeyAfterRename(form.name, browseMode);
    const nameChanged = form.name !== originalForm.name;

    if (nameChanged && tracks.length === 0) return;

    setSaving(true);
    setSaveError(null);

    const updated: Track[] = [];
    const errors: string[] = [];

    try {
      if (nameChanged) {
        setSaveProgress({ current: 0, total: tracks.length });
        for (let i = 0; i < tracks.length; i++) {
          const track = tracks[i];
          setSaveProgress({ current: i + 1, total: tracks.length });
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

        if (errors.length > 0) {
          setSaveError(
            errors.length === tracks.length
              ? errors[0]
              : `Updated ${updated.length} of ${tracks.length} tracks. ${errors[0]}`,
          );
          return;
        }

        if (oldKey !== newKey && !artChanged) {
          await renameArtistImageKey(oldKey, newKey, browseMode);
        }
      }

      if (artChanged) {
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
      setSaving(false);
      setSaveProgress(null);
    }
  };

  const displayArtSrc = useAssetUrl(
    selectedCoverUrl ? null : pendingArtPath,
  );
  const previewSrc = selectedCoverUrl ?? displayArtSrc;

  const saveLabel = saving
    ? saveProgress
      ? `Saving ${saveProgress.current}/${saveProgress.total}…`
      : "Saving…"
    : "Save";

  return (
    <Modal
      open={isOpen}
      onClose={handleBackdropClick}
      size="editor"
      panelRef={dialogRef}
      labelledBy="artist-editor-title"
    >
      {isOpen && (
        <>
          <ModalHeader>
            <ModalTitle id="artist-editor-title">Edit artist</ModalTitle>
          </ModalHeader>

          <ModalBody>
            <ModalDescription>
              {nameChangedDescription(form!, originalForm!, tracks.length, artChanged)}
            </ModalDescription>

            <div className="track-editor__body">
              <div className="track-editor__art-col">
                <div
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
                  Change Art
                </Button>
                <Button
                  size="sm"
                  className="track-editor__art-btn"
                  onClick={() => void handleFetchArt()}
                  disabled={fetchingArt}
                >
                  {fetchingArt ? "Fetching…" : "Fetch Art"}
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
                    <span>Fetching artwork…</span>
                  </div>
                )}
                {coverCandidates.length > 0 && (
                  <div
                    className="track-editor__cover-picker"
                    aria-label="Artist image options"
                  >
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
                <FormField label="Artist">
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

            {discardPrompt && (
              <div
                className="track-editor__discard"
                role="alertdialog"
                aria-labelledby="artist-editor-discard-title"
                aria-describedby="artist-editor-discard-desc"
              >
                <p
                  id="artist-editor-discard-title"
                  className="track-editor__discard-title"
                >
                  Discard changes?
                </p>
                <p
                  id="artist-editor-discard-desc"
                  className="track-editor__discard-desc"
                >
                  Unsaved edits to this artist will be lost.
                </p>
                <div className="track-editor__discard-actions">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDiscardPrompt(false)}
                  >
                    Keep editing
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={confirmDiscard}
                  >
                    Discard
                  </Button>
                </div>
              </div>
            )}
          </ModalBody>

          <ModalFooter
            onCancel={handleCancel}
            cancelDisabled={saving}
            cancelLabel={discardPrompt ? "Back" : "Cancel"}
          >
            <Button
              variant="primary"
              onClick={() => void handleSave()}
              disabled={!hasChanges || saving || discardPrompt}
            >
              {saveLabel}
            </Button>
          </ModalFooter>
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
    return `Name changes apply to all ${trackCount} ${trackCount === 1 ? "track" : "tracks"}. Artist images are stored separately from album art.`;
  }
  if (nameChanged) {
    return `Changes apply to all ${trackCount} ${trackCount === 1 ? "track" : "tracks"} for this artist.`;
  }
  return "Artist images are stored separately from album art.";
}
