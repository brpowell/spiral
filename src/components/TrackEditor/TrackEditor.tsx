import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useArtFileDrop } from "../../hooks/useArtFileDrop";
import { useAssetUrl } from "../../hooks/useAssetUrl";
import { useFileSize } from "../../hooks/useFileSize";
import { useFileExists } from "../../hooks/useFileExists";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useEditorDiscardPrompt } from "../../hooks/useEditorDiscardPrompt";
import { formatBytes, formatDimensions } from "../../lib/formatBytes";
import { parseArtistField } from "../../lib/artistNames";
import { collectArtistNameSuggestions } from "../../lib/artistNameSuggestions";
import { collectGenreSuggestions, collectAlbumSuggestions } from "../../lib/trackFieldSuggestions";
import {
  buildTrackMetadataFromForm,
  mixedFieldPlaceholder,
  sharedArtPath,
  trackEditorFormsEqual,
  trackEditorMetadataFormsEqual,
  tracksToForm,
  type TrackEditorForm,
  type TrackEditorFormField,
} from "../../lib/trackMetadataForm";
import { ArtistChipField } from "../ArtistChipField/ArtistChipField";
import { TrackRating } from "../TrackRating/TrackRating";
import { AudioFileSpecs } from "../AudioFileSpecs/AudioFileSpecs";
import { revealInFileManagerLabel, revealTrackInFileManager } from "../../lib/fileManager";
import {
  discoverTrackFileMissing,
  isTrackMissingFile,
} from "../../lib/missingFileTrack";
import {
  cacheArtFromFile,
  cacheArtFromUrl,
  fetchCoverArt,
  pickImageFile,
  setTrackRating,
  writeTrackMetadata,
} from "../../lib/tauri";
import { usePlayerStore } from "../../store/usePlayerStore";
import type { CoverArtCandidate } from "../../types/coverArt";
import type { Track } from "../../types/track";
import { EntityArt } from "../EntityArt/EntityArt";
import { EditorDiscardOverlay } from "../EditorDiscardOverlay/EditorDiscardOverlay";
import {
  Modal,
  ModalBody,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from "../common/Modal/Modal";
import { Button } from "../common/Button/Button";
import { FieldLabel, FormField } from "../common/Field/Field";
import { AutocompleteInput } from "../common/AutocompleteInput/AutocompleteInput";
import { TextInput } from "../common/TextInput/TextInput";
import { IconWarning } from "../icons";
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
  min,
  form,
  tracks,
  isBulk,
  onChange,
  suggestions,
}: {
  label: string;
  field: TrackEditorFormField;
  type?: "text" | "number";
  min?: number;
  form: TrackEditorForm;
  tracks: Track[];
  isBulk: boolean;
  onChange: (field: TrackEditorFormField, value: string) => void;
  suggestions?: string[];
}) {
  const common = {
    type,
    min,
    value: form[field],
    placeholder: isBulk ? mixedFieldPlaceholder(tracks, field, form) : undefined,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      onChange(field, e.target.value),
  };

  return (
    <FormField label={label}>
      {suggestions && type === "text" ? (
        <AutocompleteInput {...common} suggestions={suggestions} />
      ) : (
        <TextInput {...common} />
      )}
    </FormField>
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
  const artistSuggestions = useMemo(
    () => collectArtistNameSuggestions(library),
    [library],
  );
  const genreSuggestions = useMemo(
    () => collectGenreSuggestions(library),
    [library],
  );
  const albumSuggestions = useMemo(
    () => collectAlbumSuggestions(library),
    [library],
  );

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
  const fileSizeBytes = useFileSize(referenceTrack?.filePath);
  const fileExistsOnDisk = useFileExists(referenceTrack?.filePath);
  const isMissingFile =
    referenceTrack != null &&
    (isTrackMissingFile(referenceTrack) || fileExistsOnDisk === false);

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

  useEffect(() => {
    if (referenceTrack == null || fileExistsOnDisk !== false) {
      return;
    }
    void discoverTrackFileMissing(referenceTrack, updateTrackInLibrary);
  }, [referenceTrack, fileExistsOnDisk, updateTrackInLibrary]);

  const artChanged =
    pendingArtPath !== originalArtPath ||
    selectedCoverUrl != null ||
    artSourcePath != null;

  const hasChanges =
    form != null &&
    originalForm != null &&
    (!trackEditorFormsEqual(form, originalForm) || artChanged);

  const {
    discardPrompt,
    setDiscardPrompt,
    requestClose,
    handleBackdropClick,
    dismissDiscardPrompt,
  } = useEditorDiscardPrompt(hasChanges, closeTrackEditor);

  const setField = (field: TrackEditorFormField, value: string) => {
    setForm((prev) => (prev ? { ...prev, [field]: value } : prev));
  };

  const setRating = useCallback((rating: number) => {
    setForm((prev) => (prev ? { ...prev, rating } : prev));
  }, []);

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

  useArtFileDrop(isOpen && !!referenceTrack, applyArtPath);

  const handleFetchArt = async () => {
    if (!form) return;
    setFetchingArt(true);
    setFetchMessage(null);
    setCoverCandidates([]);
    setSelectedCoverUrl(null);
    setSaveError(null);
    try {
      const primaryArtist =
        parseArtistField(form.artist)[0] ??
        parseArtistField(form.albumArtist)[0] ??
        form.artist;
      const candidates = await fetchCoverArt(primaryArtist, form.album);
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
        const metadataDirty =
          !trackEditorMetadataFormsEqual(form, originalForm) || artChanged;
        const ratingDirty = form.rating !== originalForm.rating;

        let artPath = pendingArtPath;
        if (selectedCoverUrl) {
          artPath = await cacheArtFromUrl(
            selectedCoverUrl,
            referenceTrack.filePath,
          );
        }

        let updated = referenceTrack;
        if (metadataDirty) {
          const metadata = buildTrackMetadataFromForm(
            referenceTrack,
            form,
            originalForm,
            artPath,
            artChanged,
          );
          updated = await writeTrackMetadata(
            referenceTrack.id,
            referenceTrack.filePath,
            metadata,
          );
        }
        if (ratingDirty) {
          const rating = await setTrackRating(referenceTrack.id, form.rating);
          updated = { ...updated, rating };
        }
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
    <Modal
      open={isOpen}
      onClose={handleBackdropClick}
      size="editor"
      panelClassName="track-editor-modal"
      panelRef={dialogRef}
      labelledBy="track-editor-title"
    >
      {isOpen && form && (
        <>
          <div
            className="track-editor-modal__content"
            inert={discardPrompt || undefined}
          >
            <ModalHeader>
              <ModalTitle id="track-editor-title">
                {isBulk ? `Edit ${tracks.length} tracks` : "Edit track info"}
              </ModalTitle>
            </ModalHeader>

            <ModalBody>
            {isBulk ? (
              <ModalDescription>
                Updated changes will apply to all {tracks.length} tracks.
              </ModalDescription>
            ) : null}

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
                <TrackEditorField
                  label="Title"
                  field="title"
                  form={form}
                  tracks={tracks}
                  isBulk={isBulk}
                  onChange={setField}
                />
                <FormField label="Artist">
                  <ArtistChipField
                    value={form.artist}
                    onChange={(value) => setField("artist", value)}
                    placeholder={
                      isBulk
                        ? mixedFieldPlaceholder(tracks, "artist", form)
                        : undefined
                    }
                    suggestions={artistSuggestions}
                    inputAriaLabel="Track artist"
                  />
                </FormField>
                <TrackEditorField
                  label="Album"
                  field="album"
                  form={form}
                  tracks={tracks}
                  isBulk={isBulk}
                  onChange={setField}
                  suggestions={albumSuggestions}
                />
                <TrackEditorField
                  label="Album Artist"
                  field="albumArtist"
                  form={form}
                  tracks={tracks}
                  isBulk={isBulk}
                  onChange={setField}
                  suggestions={artistSuggestions}
                />
                <TrackEditorField
                  label="Year"
                  field="year"
                  type="number"
                  min={1}
                  form={form}
                  tracks={tracks}
                  isBulk={isBulk}
                  onChange={setField}
                />
                <TrackEditorField
                  label="Track Number"
                  field="trackNumber"
                  type="number"
                  min={1}
                  form={form}
                  tracks={tracks}
                  isBulk={isBulk}
                  onChange={setField}
                />
                <TrackEditorField
                  label="Disc Number"
                  field="discNumber"
                  type="number"
                  min={1}
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
                  suggestions={genreSuggestions}
                />
                {!isBulk ? (
                  <FormField label="Rating">
                    <TrackRating
                      value={form.rating}
                      size="comfortable"
                      onChange={setRating}
                    />
                  </FormField>
                ) : null}
                {!isBulk && referenceTrack ? (
                  <div className="field">
                    <FieldLabel>File</FieldLabel>
                    {isMissingFile ? (
                      <p className="track-editor__file-missing" role="status">
                        <IconWarning
                          className="track-editor__file-missing-icon"
                          aria-hidden
                        />
                        File not found at this location
                      </p>
                    ) : null}
                    <AudioFileSpecs
                      className="track-editor__audio-file-specs"
                      filePath={referenceTrack.filePath}
                      codec={referenceTrack.codec}
                      sampleRate={referenceTrack.sampleRate}
                      bitrate={referenceTrack.bitrate}
                      sizeBytes={fileSizeBytes}
                    />
                    <div className="track-editor__file-location">
                      <textarea
                        className={[
                          "track-editor__file-path",
                          isMissingFile && "track-editor__file-path--missing",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        readOnly
                        value={referenceTrack.filePath}
                        rows={1}
                        spellCheck={false}
                        aria-label="Track file path"
                      />
                      <Button
                        size="sm"
                        disabled={isMissingFile}
                        aria-label={revealInFileManagerLabel()}
                        onClick={() =>
                          void revealTrackInFileManager(
                            referenceTrack,
                            updateTrackInLibrary,
                          )
                        }
                      >
                        Reveal
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            {saveError && (
              <p className="track-editor__error" role="alert">
                {saveError}
              </p>
            )}
            </ModalBody>

            <ModalFooter
              onCancel={requestClose}
              cancelDisabled={saving}
              cancelLabel="Cancel"
            >
              <Button
                variant="primary"
                onClick={() => void handleSave()}
                disabled={!hasChanges || saving || discardPrompt}
              >
                {saveLabel}
              </Button>
            </ModalFooter>
          </div>

          <EditorDiscardOverlay
            open={discardPrompt}
            description={discardDescription}
            onKeepEditing={dismissDiscardPrompt}
            onDiscard={closeTrackEditor}
          />
        </>
      )}
    </Modal>
  );
}
