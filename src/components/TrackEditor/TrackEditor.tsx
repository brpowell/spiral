import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAssetUrl } from "../../hooks/useAssetUrl";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { formatBytes, formatDimensions } from "../../lib/formatBytes";
import {
  buildTrackMetadataFromForm,
  mixedFieldPlaceholder,
  sharedArtPath,
  trackEditorFormsEqual,
  tracksToForm,
  type TrackEditorForm,
  type TrackEditorFormField,
} from "../../lib/trackMetadataForm";
import {
  cacheArtFromFile,
  cacheArtFromUrl,
  fetchCoverArt,
  pickImageFile,
  writeTrackMetadata,
} from "../../lib/tauri";
import { usePlayerStore } from "../../store/usePlayerStore";
import type { CoverArtCandidate } from "../../types/coverArt";
import type { Track } from "../../types/track";
import { AlbumArt } from "../AlbumArt/AlbumArt";
import { AnimatedModal } from "../AnimatedModal/AnimatedModal";
import { ModalFooter } from "../ModalFooter/ModalFooter";
import { TextInput } from "../TextInput/TextInput";
import "./TrackEditor.css";

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

function TrackEditorField({
  label,
  field,
  type = "text",
  form,
  tracks,
  isBulk,
  onChange,
}: {
  label: string;
  field: TrackEditorFormField;
  type?: "text" | "number";
  form: TrackEditorForm;
  tracks: Track[];
  isBulk: boolean;
  onChange: (field: TrackEditorFormField, value: string) => void;
}) {
  return (
    <label>
      {label}
      <TextInput
        type={type}
        value={form[field]}
        placeholder={
          isBulk ? mixedFieldPlaceholder(tracks, field, form) : undefined
        }
        onChange={(e) => onChange(field, e.target.value)}
      />
    </label>
  );
}

export function TrackEditor() {
  const editingTrackIds = usePlayerStore((s) => s.editingTrackIds);
  const library = usePlayerStore((s) => s.library);
  const closeTrackEditor = usePlayerStore((s) => s.closeTrackEditor);
  const updateTrackInLibrary = usePlayerStore((s) => s.updateTrackInLibrary);
  const updateTracksInLibrary = usePlayerStore((s) => s.updateTracksInLibrary);

  const tracks = useMemo(
    () =>
      editingTrackIds
        .map((id) => library.find((t) => t.id === id))
        .filter((t): t is Track => t != null),
    [editingTrackIds, library],
  );
  const isBulk = tracks.length > 1;
  const referenceTrack = tracks[0] ?? null;
  const editingKey = editingTrackIds.join(",");

  const dialogRef = useRef<HTMLDivElement>(null);
  const [form, setForm] = useState<TrackEditorForm | null>(null);
  const [originalForm, setOriginalForm] = useState<TrackEditorForm | null>(null);
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

  const isOpen = editingTrackIds.length > 0 && tracks.length > 0 && form != null;

  useFocusTrap(dialogRef, isOpen);

  useEffect(() => {
    if (tracks.length === 0) return;
    const initial = tracksToForm(tracks);
    const initialArt = sharedArtPath(tracks);
    setForm(initial);
    setOriginalForm(initial);
    setPendingArtPath(initialArt);
    setOriginalArtPath(initialArt);
    setArtSourcePath(null);
    setCoverCandidates([]);
    setSelectedCoverUrl(null);
    setFetchMessage(null);
    setSaveError(null);
    setDiscardPrompt(false);
    setSaveProgress(null);
  }, [editingKey]);

  const artChanged =
    pendingArtPath !== originalArtPath ||
    selectedCoverUrl != null ||
    artSourcePath != null;

  const hasChanges =
    form != null &&
    originalForm != null &&
    (!trackEditorFormsEqual(form, originalForm) || artChanged);

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
    if (editingTrackIds.length === 0) return;
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
  }, [editingTrackIds.length, hasChanges, discardPrompt, closeTrackEditor]);

  const setField = (field: TrackEditorFormField, value: string) => {
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
    if (!form || !originalForm || !hasChanges || tracks.length === 0) return;

    if (!isBulk && referenceTrack) {
      setSaving(true);
      setSaveError(null);
      try {
        let artPath = pendingArtPath;
        if (selectedCoverUrl) {
          artPath = await cacheArtFromUrl(
            selectedCoverUrl,
            referenceTrack.filePath,
          );
        }
        const metadata = buildTrackMetadataFromForm(
          referenceTrack,
          form,
          originalForm,
          artPath,
          artChanged,
        );
        const updated = await writeTrackMetadata(
          referenceTrack.id,
          referenceTrack.filePath,
          metadata,
        );
        updateTrackInLibrary(updated);
        closeTrackEditor();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setSaveError(message);
      } finally {
        setSaving(false);
      }
      return;
    }

    setSaving(true);
    setSaveError(null);
    setSaveProgress({ current: 0, total: tracks.length });

    const updated: Track[] = [];
    const errors: string[] = [];

    try {
      for (let i = 0; i < tracks.length; i++) {
        const track = tracks[i];
        setSaveProgress({ current: i + 1, total: tracks.length });
        try {
          const artPath = artChanged
            ? await resolveArtPathForTrack(track)
            : track.artPath;
          const metadata = buildTrackMetadataFromForm(
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

      if (errors.length > 0) {
        setSaveError(
          errors.length === tracks.length
            ? errors[0]
            : `Updated ${updated.length} of ${tracks.length} tracks. ${errors[0]}`,
        );
        return;
      }

      closeTrackEditor();
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

  const discardDescription = isBulk
    ? `Unsaved edits to ${tracks.length} tracks will be lost.`
    : "Unsaved edits to this track will be lost.";

  return (
    <AnimatedModal
      open={isOpen}
      backdropClassName="track-editor-backdrop"
      panelClassName="track-editor"
      panelRef={dialogRef}
      labelledBy="track-editor-title"
      onBackdropClick={handleBackdropClick}
    >
      {isOpen && form && (
        <>
          <h2 id="track-editor-title" className="track-editor__heading">
            {isBulk ? `Edit ${tracks.length} tracks` : "Edit track info"}
          </h2>
          {isBulk ? (
            <p className="track-editor__subtitle">
              Updated changes will apply to all {tracks.length} tracks.
            </p>
          ) : null}

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
                  <AlbumArt
                    artPath={null}
                    className="track-editor__art-placeholder"
                  />
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
              <TrackEditorField
                label="Title"
                field="title"
                form={form}
                tracks={tracks}
                isBulk={isBulk}
                onChange={setField}
              />
              <TrackEditorField
                label="Artist"
                field="artist"
                form={form}
                tracks={tracks}
                isBulk={isBulk}
                onChange={setField}
              />
              <TrackEditorField
                label="Album"
                field="album"
                form={form}
                tracks={tracks}
                isBulk={isBulk}
                onChange={setField}
              />
              <TrackEditorField
                label="Album Artist"
                field="albumArtist"
                form={form}
                tracks={tracks}
                isBulk={isBulk}
                onChange={setField}
              />
              <TrackEditorField
                label="Year"
                field="year"
                type="number"
                form={form}
                tracks={tracks}
                isBulk={isBulk}
                onChange={setField}
              />
              <TrackEditorField
                label="Track Number"
                field="trackNumber"
                type="number"
                form={form}
                tracks={tracks}
                isBulk={isBulk}
                onChange={setField}
              />
              <TrackEditorField
                label="Disc Number"
                field="discNumber"
                type="number"
                form={form}
                tracks={tracks}
                isBulk={isBulk}
                onChange={setField}
              />
              <TrackEditorField
                label="Genre"
                field="genre"
                form={form}
                tracks={tracks}
                isBulk={isBulk}
                onChange={setField}
              />
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
              <p
                id="track-editor-discard-title"
                className="track-editor__discard-title"
              >
                Discard changes?
              </p>
              <p
                id="track-editor-discard-desc"
                className="track-editor__discard-desc"
              >
                {discardDescription}
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
              {saveLabel}
            </button>
          </ModalFooter>
        </>
      )}
    </AnimatedModal>
  );
}
