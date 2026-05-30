import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAssetUrl } from "../../hooks/useAssetUrl";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import {
  albumFormsEqual,
  albumToForm,
  buildTrackAlbumMetadata,
  type AlbumEditorForm,
} from "../../lib/albumMetadata";
import { albumKey, getAlbumByKey, groupTracksIntoAlbums } from "../../lib/albums";
import { formatBytes, formatDimensions } from "../../lib/formatBytes";
import {
  cacheArtFromFile,
  cacheArtFromUrl,
  fetchCoverArt,
  pickImageFile,
  writeTrackMetadata,
} from "../../lib/tauri";
import { useNavigationStore } from "../../store/useNavigationStore";
import { usePlayerStore } from "../../store/usePlayerStore";
import type { CoverArtCandidate } from "../../types/coverArt";
import type { Track } from "../../types/track";
import { EntityArt } from "../EntityArt/EntityArt";
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
import "./AlbumEditor.css";

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

export function AlbumEditor() {
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

  const dialogRef = useRef<HTMLDivElement>(null);
  const [form, setForm] = useState<AlbumEditorForm | null>(null);
  const [originalForm, setOriginalForm] = useState<AlbumEditorForm | null>(null);
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
    setSaveProgress(null);
  }, [album?.key]);

  const artChanged =
    pendingArtPath !== originalArtPath ||
    selectedCoverUrl != null ||
    artSourcePath != null;

  const hasChanges =
    form != null &&
    originalForm != null &&
    (!albumFormsEqual(form, originalForm) || artChanged);

  const requestClose = useCallback(() => {
    if (hasChanges) {
      setDiscardPrompt(true);
      return;
    }
    closeAlbumEditor();
  }, [hasChanges, closeAlbumEditor]);

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
    closeAlbumEditor();
  };

  useEffect(() => {
    if (editingAlbumKey == null) return;
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
      closeAlbumEditor();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editingAlbumKey, hasChanges, discardPrompt, closeAlbumEditor]);

  const setField = (field: keyof AlbumEditorForm, value: string) => {
    setForm((prev) => (prev ? { ...prev, [field]: value } : prev));
  };

  const applyArtPath = async (sourcePath: string) => {
    if (!referenceTrack) return;
    setSaveError(null);
    try {
      const cached = await cacheArtFromFile(sourcePath, referenceTrack.filePath);
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
      const candidates = await fetchCoverArt(form.artist, form.title);
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

  const resolveArtPathForTrack = async (track: Track): Promise<string | null> => {
    if (selectedCoverUrl) {
      return cacheArtFromUrl(selectedCoverUrl, track.filePath);
    }
    if (artSourcePath) {
      return cacheArtFromFile(artSourcePath, track.filePath);
    }
    return pendingArtPath;
  };

  const handleSave = async () => {
    if (!album || !form || !hasChanges || tracks.length === 0) return;
    setSaving(true);
    setSaveError(null);
    setSaveProgress({ current: 0, total: tracks.length });

    const updated: Track[] = [];
    const errors: string[] = [];
    const oldKey = album.key;

    try {
      for (let i = 0; i < tracks.length; i++) {
        const track = tracks[i];
        setSaveProgress({ current: i + 1, total: tracks.length });
        try {
          const artPath = artChanged
            ? await resolveArtPathForTrack(track)
            : track.artPath;
          const metadata = buildTrackAlbumMetadata(
            track,
            form,
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

      if (errors.length > 0) {
        setSaveError(
          errors.length === tracks.length
            ? errors[0]
            : `Updated ${updated.length} of ${tracks.length} tracks. ${errors[0]}`,
        );
        return;
      }

      const newKey = albumKey(updated[0]);
      if (useNavigationStore.getState().albumKey === oldKey) {
        useNavigationStore.setState({ albumKey: newKey });
      }
      closeAlbumEditor();
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
      labelledBy="album-editor-title"
    >
      {isOpen && (
        <>
          <ModalHeader>
            <ModalTitle id="album-editor-title">Edit album</ModalTitle>
          </ModalHeader>

          <ModalBody>
            <ModalDescription>
              Changes apply to all {tracks.length}{" "}
              {tracks.length === 1 ? "track" : "tracks"} in this album.
            </ModalDescription>

            <div className="track-editor__body">
              <div className="track-editor__art-col">
                <div
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
                    aria-label="Cover art options"
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
                <FormField label="Album">
                  <TextInput
                    value={form.title}
                    onChange={(e) => setField("title", e.target.value)}
                  />
                </FormField>
                <FormField label="Album Artist">
                  <TextInput
                    value={form.artist}
                    onChange={(e) => setField("artist", e.target.value)}
                  />
                </FormField>
                <FormField label="Year">
                  <TextInput
                    type="number"
                    value={form.year}
                    onChange={(e) => setField("year", e.target.value)}
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
                aria-labelledby="album-editor-discard-title"
                aria-describedby="album-editor-discard-desc"
              >
                <p
                  id="album-editor-discard-title"
                  className="track-editor__discard-title"
                >
                  Discard changes?
                </p>
                <p
                  id="album-editor-discard-desc"
                  className="track-editor__discard-desc"
                >
                  Unsaved edits to this album will be lost.
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
