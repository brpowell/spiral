import { convertFileSrc } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import {
  cacheArtFromFile,
  cacheArtFromUrl,
  fetchCoverArt,
  pickImageFile,
  writeTrackMetadata,
} from "../../lib/tauri";
import { usePlayerStore } from "../../store/usePlayerStore";
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
  const [coverUrls, setCoverUrls] = useState<string[]>([]);
  const [fetchMessage, setFetchMessage] = useState<string | null>(null);
  const [artDragOver, setArtDragOver] = useState(false);

  const isOpen = editingTrackId != null && track != null && form != null;

  useFocusTrap(dialogRef, isOpen);

  useEffect(() => {
    if (!track) return;
    const initial = trackToForm(track);
    setForm(initial);
    setOriginalForm(initial);
    setPendingArtPath(track.artPath);
    setOriginalArtPath(track.artPath);
    setCoverUrls([]);
    setFetchMessage(null);
    setSaveError(null);
  }, [track?.id]);

  const hasChanges =
    form != null &&
    originalForm != null &&
    (!formsEqual(form, originalForm) || pendingArtPath !== originalArtPath);

  const handleBackdropClick = useCallback(() => {
    if (hasChanges && !confirm("Discard changes?")) return;
    closeTrackEditor();
  }, [hasChanges, closeTrackEditor]);

  const handleCancel = () => {
    if (hasChanges && !confirm("Discard changes?")) return;
    closeTrackEditor();
  };

  useEffect(() => {
    if (editingTrackId == null) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (hasChanges && !confirm("Discard changes?")) return;
        closeTrackEditor();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editingTrackId, hasChanges, closeTrackEditor]);

  const setField = (field: keyof EditorForm, value: string) => {
    setForm((prev) => (prev ? { ...prev, [field]: value } : prev));
  };

  const applyArtPath = async (sourcePath: string) => {
    if (!track) return;
    setSaveError(null);
    try {
      const cached = await cacheArtFromFile(sourcePath, track.filePath);
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
    setCoverUrls([]);
    setSaveError(null);
    try {
      const urls = await fetchCoverArt(form.artist, form.album);
      if (urls.length === 0) {
        setFetchMessage("No results found");
      } else {
        setCoverUrls(urls);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSaveError(message);
    } finally {
      setFetchingArt(false);
    }
  };

  const handleSelectCover = async (url: string) => {
    if (!track) return;
    setSaveError(null);
    try {
      const cached = await cacheArtFromUrl(url, track.filePath);
      setPendingArtPath(cached);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSaveError(message);
    }
  };

  const handleSave = async () => {
    if (!track || !form || !hasChanges) return;
    setSaving(true);
    setSaveError(null);
    try {
      const metadata = formToMetadata(form, pendingArtPath);
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

  const displayArtPath = pendingArtPath;

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
              {displayArtPath ? (
                <img
                  src={convertFileSrc(displayArtPath)}
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
            {fetchMessage && (
              <p className="track-editor__fetch-msg">{fetchMessage}</p>
            )}
            {coverUrls.length > 0 && (
              <div className="track-editor__cover-picker">
                {coverUrls.map((url) => (
                  <button
                    key={url}
                    type="button"
                    className="track-editor__cover-thumb"
                    onClick={() => void handleSelectCover(url)}
                  >
                    <img src={url} alt="" />
                  </button>
                ))}
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

        <ModalFooter onCancel={handleCancel} cancelDisabled={saving}>
          <button
            type="button"
            className="modal-footer__btn modal-footer__btn--primary"
            onClick={() => void handleSave()}
            disabled={!hasChanges || saving}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </ModalFooter>
        </>
      )}
    </AnimatedModal>
  );
}
