import { useCallback, useEffect, useRef, useState } from "react";
import { useAssetUrl } from "../../hooks/useAssetUrl";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { formatBytes, formatDimensions } from "../../lib/formatBytes";
import {
  cacheArtFromFile,
  cacheArtFromUrl,
  fetchCoverArt,
  pickImageFile,
  writeTrackMetadata,
} from "../../lib/tauri";
import { usePlayerStore } from "../../store/usePlayerStore";
import type { CoverArtCandidate } from "../../types/coverArt";
import type { TrackMetadataUpdate } from "../../types/metadata";
import type { Track } from "../../types/track";
import { AlbumArt } from "../AlbumArt/AlbumArt";
import { AnimatedModal } from "../AnimatedModal/AnimatedModal";
import { ModalFooter } from "../ModalFooter/ModalFooter";
import "./TrackEditor.css";

interface EditorForm {
  title: string;
  artist: string;
  album: string;
  albumArtist: string;
  year: string;
  trackNumber: string;
  discNumber: string;
  genre: string;
}

function trackToForm(track: Track): EditorForm {
  return {
    title: track.title,
    artist: track.artist ?? "",
    album: track.album ?? "",
    albumArtist: track.albumArtist ?? "",
    year: track.year != null ? String(track.year) : "",
    trackNumber: track.trackNumber != null ? String(track.trackNumber) : "",
    discNumber: track.discNumber != null ? String(track.discNumber) : "",
    genre: track.genre ?? "",
  };
}

function parseOptionalInt(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number.parseInt(trimmed, 10);
  return Number.isFinite(n) ? n : null;
}

function formToMetadata(form: EditorForm, artPath: string | null): TrackMetadataUpdate {
  return {
    title: form.title.trim() || "Unknown",
    artist: form.artist.trim() || null,
    album: form.album.trim() || null,
    albumArtist: form.albumArtist.trim() || null,
    year: parseOptionalInt(form.year),
    trackNumber: parseOptionalInt(form.trackNumber),
    discNumber: parseOptionalInt(form.discNumber),
    genre: form.genre.trim() || null,
    artPath,
  };
}

function formsEqual(a: EditorForm, b: EditorForm): boolean {
  return (
    a.title === b.title &&
    a.artist === b.artist &&
    a.album === b.album &&
    a.albumArtist === b.albumArtist &&
    a.year === b.year &&
    a.trackNumber === b.trackNumber &&
    a.discNumber === b.discNumber &&
    a.genre === b.genre
  );
}

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

export function TrackEditor() {
  const editingTrackId = usePlayerStore((s) => s.editingTrackId);
  const library = usePlayerStore((s) => s.library);
  const closeTrackEditor = usePlayerStore((s) => s.closeTrackEditor);
  const updateTrackInLibrary = usePlayerStore((s) => s.updateTrackInLibrary);

  const track = library.find((t) => t.id === editingTrackId) ?? null;

  const dialogRef = useRef<HTMLDivElement>(null);
  const [form, setForm] = useState<EditorForm | null>(null);
  const [originalForm, setOriginalForm] = useState<EditorForm | null>(null);
  const [pendingArtPath, setPendingArtPath] = useState<string | null>(null);
  const [originalArtPath, setOriginalArtPath] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [fetchingArt, setFetchingArt] = useState(false);
  const [coverCandidates, setCoverCandidates] = useState<CoverArtCandidate[]>([]);
  const [selectedCoverUrl, setSelectedCoverUrl] = useState<string | null>(null);
  const [fetchMessage, setFetchMessage] = useState<string | null>(null);
  const [artDragOver, setArtDragOver] = useState(false);
  const [discardPrompt, setDiscardPrompt] = useState(false);

  const isOpen = editingTrackId != null && track != null && form != null;

  useFocusTrap(dialogRef, isOpen);

  useEffect(() => {
    if (!track) return;
    const initial = trackToForm(track);
    setForm(initial);
    setOriginalForm(initial);
    setPendingArtPath(track.artPath);
    setOriginalArtPath(track.artPath);
    setCoverCandidates([]);
    setSelectedCoverUrl(null);
    setFetchMessage(null);
    setSaveError(null);
    setDiscardPrompt(false);
  }, [track?.id]);

  const hasChanges =
    form != null &&
    originalForm != null &&
    (!formsEqual(form, originalForm) ||
      pendingArtPath !== originalArtPath ||
      selectedCoverUrl != null);

  const requestClose = useCallback(() => {
    if (hasChanges) {
      setDiscardPrompt(true);
      return;
    }
    closeTrackEditor();
  }, [hasChanges, closeTrackEditor]);

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
    closeTrackEditor();
  };

  useEffect(() => {
    if (editingTrackId == null) return;
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
      closeTrackEditor();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editingTrackId, hasChanges, discardPrompt, closeTrackEditor]);

  const setField = (field: keyof EditorForm, value: string) => {
    setForm((prev) => (prev ? { ...prev, [field]: value } : prev));
  };

  const applyArtPath = async (sourcePath: string) => {
    if (!track) return;
    setSaveError(null);
    try {
      const cached = await cacheArtFromFile(sourcePath, track.filePath);
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
    if (!track) return;

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
      const candidates = await fetchCoverArt(form.artist, form.album);
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
  };

  const handleSave = async () => {
    if (!track || !form || !hasChanges) return;
    setSaving(true);
    setSaveError(null);
    try {
      let artPath = pendingArtPath;
      if (selectedCoverUrl) {
        artPath = await cacheArtFromUrl(selectedCoverUrl, track.filePath);
      }
      const metadata = formToMetadata(form, artPath);
      const updated = await writeTrackMetadata(track.id, track.filePath, metadata);
      updateTrackInLibrary(updated);
      closeTrackEditor();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSaveError(message);
    } finally {
      setSaving(false);
    }
  };

  const displayArtSrc = useAssetUrl(
    selectedCoverUrl ? null : pendingArtPath,
  );
  const previewSrc = selectedCoverUrl ?? displayArtSrc;

  return (
    <AnimatedModal
      open={isOpen}
      backdropClassName="track-editor-backdrop"
      panelClassName="track-editor"
      panelRef={dialogRef}
      labelledBy="track-editor-title"
      onBackdropClick={handleBackdropClick}
    >
      {isOpen && (
        <>
        <h2 id="track-editor-title" className="track-editor__heading">
          Edit track info
        </h2>

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
                <AlbumArt artPath={null} className="track-editor__art-placeholder" />
              )}
            </div>
            <button
              type="button"
              className="track-editor__art-btn"
              onClick={() => void handleChangeArt()}
            >
              Change Art
            </button>
            <button
              type="button"
              className="track-editor__art-btn"
              onClick={() => void handleFetchArt()}
              disabled={fetchingArt}
            >
              {fetchingArt ? "Fetching…" : "Fetch Art"}
            </button>
            {fetchMessage && !fetchingArt && (
              <p className="track-editor__fetch-msg">{fetchMessage}</p>
            )}
            {fetchingArt && (
              <div className="track-editor__fetching" role="status" aria-live="polite">
                <span className="track-editor__fetching-spinner" aria-hidden />
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
            <label>
              Title
              <input
                type="text"
                value={form.title}
                onChange={(e) => setField("title", e.target.value)}
              />
            </label>
            <label>
              Artist
              <input
                type="text"
                value={form.artist}
                onChange={(e) => setField("artist", e.target.value)}
              />
            </label>
            <label>
              Album
              <input
                type="text"
                value={form.album}
                onChange={(e) => setField("album", e.target.value)}
              />
            </label>
            <label>
              Album Artist
              <input
                type="text"
                value={form.albumArtist}
                onChange={(e) => setField("albumArtist", e.target.value)}
              />
            </label>
            <label>
              Year
              <input
                type="number"
                value={form.year}
                onChange={(e) => setField("year", e.target.value)}
              />
            </label>
            <label>
              Track Number
              <input
                type="number"
                value={form.trackNumber}
                onChange={(e) => setField("trackNumber", e.target.value)}
              />
            </label>
            <label>
              Disc Number
              <input
                type="number"
                value={form.discNumber}
                onChange={(e) => setField("discNumber", e.target.value)}
              />
            </label>
            <label>
              Genre
              <input
                type="text"
                value={form.genre}
                onChange={(e) => setField("genre", e.target.value)}
              />
            </label>
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
            aria-labelledby="track-editor-discard-title"
            aria-describedby="track-editor-discard-desc"
          >
            <p id="track-editor-discard-title" className="track-editor__discard-title">
              Discard changes?
            </p>
            <p id="track-editor-discard-desc" className="track-editor__discard-desc">
              Unsaved edits to this track will be lost.
            </p>
            <div className="track-editor__discard-actions">
              <button
                type="button"
                className="track-editor__discard-btn"
                onClick={() => setDiscardPrompt(false)}
              >
                Keep editing
              </button>
              <button
                type="button"
                className="track-editor__discard-btn track-editor__discard-btn--danger"
                onClick={confirmDiscard}
              >
                Discard
              </button>
            </div>
          </div>
        )}

        <ModalFooter
          onCancel={handleCancel}
          cancelDisabled={saving}
          cancelLabel={discardPrompt ? "Back" : "Cancel"}
        >
          <button
            type="button"
            className="modal-footer__btn modal-footer__btn--primary"
            onClick={() => void handleSave()}
            disabled={!hasChanges || saving || discardPrompt}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </ModalFooter>
        </>
      )}
    </AnimatedModal>
  );
}
