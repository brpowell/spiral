import { useEffect, useMemo, useRef, useState, useCallback } from "react";
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
import { parseArtistField } from "../../lib/artistNames";
import { collectArtistNameSuggestions } from "../../lib/artistNameSuggestions";
import {
  collectGenreSuggestions,
  collectAlbumSuggestions,
} from "../../lib/trackFieldSuggestions";
import { parseTrackMetadata } from "../../lib/metadata";
import {
  buildTrackMetadataFromForm,
  isLyricsInstrumentalMixed,
  lyricsEditorStateEqual,
  sharedArtPath,
  trackEditorFormsEqual,
  trackEditorMetadataFormsEqual,
  tracksToForm,
  type TrackEditorForm,
  type TrackEditorFormField,
} from "../../lib/trackMetadataForm";
import {
  discoverTrackFileMissing,
  isMissingFileError,
  missingFileErrorDetail,
  withTrackMissingFile,
} from "../../lib/missingFileTrack";
import {
  LYRICS_FETCH_NOT_FOUND,
  createLyricsFetchFeedback,
  type LyricsFetchFeedback,
  type LyricsLibraryTrackRef,
} from "../../lib/lyricsFetch";
import { runLyricsFetchInBackground } from "../../lib/lyricsFetchToast";
import { commitFetchedLyricsForTrack } from "../../lib/lyricsFetchCommit";
import { showBulkTrackMetadataSaveToast } from "../../lib/trackMetadataToast";
import { preloadCoverArtThumbs } from "../../lib/coverArtThumbs";
import {
  cacheArtFromFile,
  cacheArtFromUrl,
  fetchCoverArt,
  getTrackLyrics,
  pickImageFile,
  setTrackRating,
  writeTrackMetadata,
} from "../../lib/tauri";
import {
  usePlayerStore,
  type TrackEditorTab,
} from "../../store/usePlayerStore";
import { useLyricsFetchStore } from "../../store/useLyricsFetchStore";
import type { CoverArtCandidate } from "../../types/coverArt";
import type { Track } from "../../types/track";
import type {
  LyricsFormat,
  LyricsLine,
  LyricsSearchCandidate,
  LyricsSource,
} from "../../types/lyrics";
import { EditorSaveButton } from "../EditorSaveButton/EditorSaveButton";
import { EditorDiscardOverlay } from "../EditorDiscardOverlay/EditorDiscardOverlay";
import {
  Modal,
  ModalBody,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalHeaderMain,
  ModalTitle,
} from "../common/Modal/Modal";
import { Tab, TabList, TabPanel, Tabs } from "../common/Tabs/Tabs";
import { EntityArt } from "../EntityArt/EntityArt";
import { AlbumArtPicker } from "../AlbumEditor/AlbumArtPicker";
import { AlbumEditorArtTab } from "../AlbumEditor/AlbumEditorArtTab";
import { TrackEditorDetailsTab } from "./TrackEditorDetailsTab";
import { TrackEditorFileTab } from "./TrackEditorFileTab";
import { TrackEditorLyricsTab } from "./TrackEditorLyricsTab";
import { LyricsCandidatePicker } from "../LyricsCandidatePicker/LyricsCandidatePicker";
import "./TrackEditor.css";

type LoadedTrackLyrics = {
  text: string;
  syncedLines: LyricsLine[] | null;
  source: LyricsSource;
  instrumental: boolean;
};

async function loadTrackLyrics(track: Track): Promise<LoadedTrackLyrics> {
  const empty: LoadedTrackLyrics = {
    text: "",
    syncedLines: null,
    source: null,
    instrumental: false,
  };

  try {
    const dbLyrics = await getTrackLyrics(track.id);
    if (dbLyrics?.format === "instrumental") {
      return {
        text: "",
        syncedLines: null,
        source: dbLyrics.source,
        instrumental: true,
      };
    }
    if (dbLyrics?.plainText) {
      return {
        text: dbLyrics.plainText,
        syncedLines: dbLyrics.format === "line_synced" ? dbLyrics.lines : null,
        source: dbLyrics.source,
        instrumental: false,
      };
    }
  } catch {
    // Fall through to embedded tag / sidecar read.
  }

  try {
    const parsed = await parseTrackMetadata(track.filePath);
    if (parsed.lyrics?.plainText) {
      return {
        text: parsed.lyrics.plainText,
        syncedLines:
          parsed.lyrics.format === "line_synced" ? parsed.lyrics.lines : null,
        source: parsed.lyrics.source,
        instrumental: false,
      };
    }
  } catch {
    return empty;
  }

  return empty;
}

function lyricsFormFieldsFromLoaded(loaded: LoadedTrackLyrics) {
  return {
    lyrics: loaded.text,
    lyricsSyncedLines: loaded.syncedLines,
    lyricsSource: loaded.source,
    lyricsInstrumental: loaded.instrumental,
  };
}

export function TrackEditor() {
  const { t } = useTranslation(["library", "common"]);
  const editingTrackIds = usePlayerStore((s) => s.editingTrackIds);
  const trackEditorInitialTab = usePlayerStore((s) => s.trackEditorInitialTab);
  const library = usePlayerStore((s) => s.library);
  const closeTrackEditor = usePlayerStore((s) => s.closeTrackEditor);
  const updateTrackInLibrary = usePlayerStore((s) => s.updateTrackInLibrary);
  const updateTracksInLibrary = usePlayerStore((s) => s.updateTracksInLibrary);
  const notifyTrackLyricsUpdated = usePlayerStore(
    (s) => s.notifyTrackLyricsUpdated,
  );

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
  const [activeTab, setActiveTab] = useState<TrackEditorTab>("details");
  const [form, setForm] = useState<TrackEditorForm | null>(null);
  const [originalForm, setOriginalForm] = useState<TrackEditorForm | null>(
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
    finish,
  } = useCancellableBulkSave();
  const [fetchingArt, setFetchingArt] = useState(false);
  const [coverCandidates, setCoverCandidates] = useState<CoverArtCandidate[]>(
    [],
  );
  const [selectedCoverUrl, setSelectedCoverUrl] = useState<string | null>(null);
  const [fetchMessage, setFetchMessage] = useState<string | null>(null);
  const [lyricsFetchFeedback, setLyricsFetchFeedback] =
    useState<LyricsFetchFeedback | null>(null);
  const [committingLyrics, setCommittingLyrics] = useState(false);
  const [lyricsCandidates, setLyricsCandidates] = useState<
    LyricsSearchCandidate[]
  >([]);
  const [artDragOver, setArtDragOver] = useState(false);
  const [artPickerOpen, setArtPickerOpen] = useState(false);
  const artFetchGenRef = useRef(0);

  const isOpen =
    editingTrackIds.length > 0 && tracks.length > 0 && form != null;

  const lyricsFetchPending = useLyricsFetchStore((s) =>
    referenceTrack
      ? s.fetchingTrackIds.has(referenceTrack.id) ||
        s.queuedTrackIds.has(referenceTrack.id)
      : false,
  );

  const lyricsRevision = usePlayerStore((s) =>
    referenceTrack ? (s.lyricsRevisionByTrackId[referenceTrack.id] ?? 0) : 0,
  );

  const lyricsLibraryTrack = useMemo((): LyricsLibraryTrackRef | null => {
    if (!referenceTrack || !form) return null;
    return {
      title: form.title.trim() || referenceTrack.title,
      artist: form.artist.trim() || referenceTrack.artist?.trim() || "",
      album: form.album.trim() || referenceTrack.album?.trim() || "",
      durationSeconds: referenceTrack.durationSeconds ?? null,
    };
  }, [form, referenceTrack]);

  useFocusTrap(dialogRef, isOpen);

  useEffect(() => {
    if (tracks.length === 0) return;

    const initial = tracksToForm(tracks);
    const initialArt = sharedArtPath(tracks);
    setActiveTab(trackEditorInitialTab);
    setForm(initial);
    setOriginalForm(initial);
    setPendingArtPath(initialArt);
    setOriginalArtPath(initialArt);
    setArtSourcePath(null);
    setCoverCandidates([]);
    setSelectedCoverUrl(null);
    setFetchMessage(null);
    setArtPickerOpen(false);
    artFetchGenRef.current += 1;
    setSaveError(null);
    setDiscardPrompt(false);
    finish();

    if (!isBulk && referenceTrack) {
      const pending = useLyricsFetchStore
        .getState()
        .takePending(referenceTrack.id);
      setLyricsFetchFeedback(pending?.feedback ?? null);
      setLyricsCandidates(pending?.candidates ?? []);
    } else {
      setLyricsFetchFeedback(null);
      setLyricsCandidates([]);
    }

    if (!isBulk && referenceTrack) {
      let cancelled = false;
      void loadTrackLyrics(referenceTrack).then((loadedLyrics) => {
        if (cancelled) return;
        const lyricsUpdate = lyricsFormFieldsFromLoaded(loadedLyrics);
        setForm((prev) => (prev ? { ...prev, ...lyricsUpdate } : prev));
        setOriginalForm((prev) => (prev ? { ...prev, ...lyricsUpdate } : prev));
      });
      return () => {
        cancelled = true;
      };
    }
    // Reset only when the edited selection/tab changes — `tracks` would wipe
    // in-progress edits on library refresh. setDiscardPrompt is stable useState.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key-gated form reset
  }, [editingKey, trackEditorInitialTab]);

  useEffect(() => {
    if (!referenceTrack || isBulk) return;

    return useLyricsFetchStore.subscribe((state, prev) => {
      const next = state.pendingByTrackId[referenceTrack.id];
      const previous = prev.pendingByTrackId[referenceTrack.id];
      if (next && next !== previous) {
        setLyricsFetchFeedback(next.feedback);
        setLyricsCandidates(next.candidates);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- subscribe by track id, not object identity
  }, [referenceTrack?.id, isBulk]);

  useEffect(() => {
    if (!referenceTrack || isBulk || lyricsRevision === 0) return;

    let cancelled = false;
    void loadTrackLyrics(referenceTrack).then((loadedLyrics) => {
      if (cancelled) return;
      const lyricsUpdate = lyricsFormFieldsFromLoaded(loadedLyrics);
      setForm((prev) => (prev ? { ...prev, ...lyricsUpdate } : prev));
      setOriginalForm((prev) => (prev ? { ...prev, ...lyricsUpdate } : prev));
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload by track id + lyricsRevision
  }, [referenceTrack?.id, lyricsRevision, isBulk]);

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
  } = useEditorDiscardPrompt(hasChanges, closeTrackEditor, saving);

  const footerCancel = bulkSaveFooterProps({
    saving,
    saveProgress,
    cancelRequested,
    requestCancel,
    requestClose,
    t,
  });

  const setField = (field: TrackEditorFormField, value: string) => {
    setForm((prev) => (prev ? { ...prev, [field]: value } : prev));
  };

  const setLyrics = useCallback(
    (update: {
      text: string;
      syncedLines: LyricsLine[] | null;
      format: LyricsFormat;
    }) => {
      setForm((prev) => {
        if (!prev || !originalForm) {
          return prev;
        }

        const nextLyrics = {
          lyrics: update.text,
          lyricsSyncedLines: update.syncedLines,
          lyricsInstrumental: false,
        };

        if (lyricsEditorStateEqual(nextLyrics, originalForm)) {
          if (lyricsEditorStateEqual(prev, originalForm)) {
            return prev;
          }

          return {
            ...prev,
            lyrics: originalForm.lyrics,
            lyricsSyncedLines: originalForm.lyricsSyncedLines,
            lyricsSource: originalForm.lyricsSource,
            lyricsInstrumental: originalForm.lyricsInstrumental,
          };
        }

        if (lyricsEditorStateEqual(nextLyrics, prev)) {
          return prev;
        }

        return {
          ...prev,
          lyrics: update.text,
          lyricsSyncedLines: update.syncedLines,
          lyricsSource: "manual",
          lyricsInstrumental: false,
        };
      });
      setLyricsFetchFeedback(null);
    },
    [originalForm],
  );

  const setLyricsInstrumental = useCallback(
    (instrumental: boolean) => {
      setForm((prev) => {
        if (!prev || !originalForm) return prev;
        if (instrumental === prev.lyricsInstrumental) return prev;

        // Keep lyrics in form state while marked instrumental so a quick
        // retoggle restores them; save ignores text when instrumental is set.
        const next = {
          ...prev,
          lyricsInstrumental: instrumental,
        };

        if (lyricsEditorStateEqual(next, originalForm)) {
          return {
            ...prev,
            lyrics: originalForm.lyrics,
            lyricsSyncedLines: originalForm.lyricsSyncedLines,
            lyricsSource: originalForm.lyricsSource,
            lyricsInstrumental: originalForm.lyricsInstrumental,
          };
        }

        return next;
      });
      setLyricsFetchFeedback(null);
    },
    [originalForm],
  );

  const commitFetchedLyrics = useCallback(
    async (input: {
      plainText: string;
      lines: LyricsLine[];
      format: LyricsFormat;
    }) => {
      if (!referenceTrack || !originalForm) return;

      const lyricsState = {
        lyrics: input.plainText,
        lyricsSyncedLines: input.format === "line_synced" ? input.lines : null,
        lyricsSource: "lrclib" as const,
        lyricsInstrumental: false,
      };

      setForm((prev) => (prev ? { ...prev, ...lyricsState } : prev));

      const result = await commitFetchedLyricsForTrack(referenceTrack, input);
      if (result.status === "ok") {
        setOriginalForm((prev) => (prev ? { ...prev, ...lyricsState } : prev));
        setSaveError(null);
        return;
      }

      if (result.status === "missing_file") {
        setSaveError(missingFileErrorDetail(referenceTrack));
        return;
      }

      setSaveError(result.message);
      setLyricsFetchFeedback(
        createLyricsFetchFeedback(t("library:editor.lyrics.commitFailed")),
      );
    },
    [originalForm, referenceTrack, t],
  );

  const handleFetchLyrics = useCallback(async () => {
    if (!referenceTrack || lyricsFetchPending) return;

    setLyricsFetchFeedback(null);
    setSaveError(null);

    const artist = form?.artist.trim() || referenceTrack.artist?.trim() || "";
    const albumArtist =
      form?.albumArtist.trim() || referenceTrack.albumArtist?.trim() || "";
    const title = form?.title.trim() || referenceTrack.title.trim();
    const album = form?.album.trim() || referenceTrack.album?.trim() || "";

    if (!artist || !title) {
      setLyricsFetchFeedback(
        createLyricsFetchFeedback(
          t("library:editor.lyrics.artistTitleRequired"),
        ),
      );
      return;
    }

    if (!referenceTrack.durationSeconds) {
      setLyricsFetchFeedback(
        createLyricsFetchFeedback(t("library:editor.lyrics.durationRequired")),
      );
      return;
    }

    setLyricsCandidates([]);
    runLyricsFetchInBackground(referenceTrack.id, title, {
      artist,
      albumArtist,
      title,
      album,
      durationSeconds: referenceTrack.durationSeconds,
    });
  }, [lyricsFetchPending, form, referenceTrack, t]);

  const handleSelectLyricsCandidate = useCallback(
    async (candidate: LyricsSearchCandidate) => {
      setLyricsCandidates([]);
      setLyricsFetchFeedback(null);
      setCommittingLyrics(true);
      try {
        await commitFetchedLyrics({
          plainText: candidate.lyrics.plainText,
          lines: candidate.lyrics.lines,
          format: candidate.lyrics.format,
        });
        if (referenceTrack) {
          useLyricsFetchStore.getState().clearPending(referenceTrack.id);
        }
      } finally {
        setCommittingLyrics(false);
      }
    },
    [commitFetchedLyrics, referenceTrack],
  );

  const handleDismissLyricsCandidates = useCallback(() => {
    setLyricsCandidates([]);
    setLyricsFetchFeedback(LYRICS_FETCH_NOT_FOUND);
    if (referenceTrack) {
      useLyricsFetchStore.getState().clearPending(referenceTrack.id);
    }
  }, [referenceTrack]);

  const setRating = useCallback((rating: number) => {
    setForm((prev) => (prev ? { ...prev, rating } : prev));
  }, []);

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

  const closeArtPicker = () => {
    artFetchGenRef.current += 1;
    setArtPickerOpen(false);
    setFetchingArt(false);
    setCoverCandidates([]);
    setFetchMessage(null);
  };

  const handleFetchArt = async () => {
    if (!form) return;
    const gen = ++artFetchGenRef.current;
    setArtPickerOpen(true);
    setFetchingArt(true);
    setFetchMessage(null);
    setCoverCandidates([]);
    setSaveError(null);
    try {
      const primaryArtist =
        parseArtistField(form.artist)[0] ??
        parseArtistField(form.albumArtist)[0] ??
        form.artist;
      const candidates = await fetchCoverArt(primaryArtist, form.album);
      if (gen !== artFetchGenRef.current) return;
      if (candidates.length === 0) {
        setFetchMessage(t("library:editor.noArtResults"));
      } else {
        await preloadCoverArtThumbs(candidates);
        if (gen !== artFetchGenRef.current) return;
        setCoverCandidates(candidates);
      }
    } catch {
      if (gen !== artFetchGenRef.current) return;
      setFetchMessage(t("library:editor.artPicker.fetchFailed"));
    } finally {
      if (gen === artFetchGenRef.current) setFetchingArt(false);
    }
  };

  const handleSelectCover = (url: string) => {
    setSaveError(null);
    setSelectedCoverUrl(url);
    setArtSourcePath(null);
    setArtPickerOpen(false);
    setCoverCandidates([]);
    setFetchMessage(null);
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
    if (!form || !originalForm || !hasChanges || tracks.length === 0) return;

    if (!isBulk && referenceTrack) {
      beginQuick();
      setSaveError(null);
      try {
        const metadataDirty =
          !trackEditorMetadataFormsEqual(form, originalForm) || artChanged;
        const ratingDirty = form.rating !== originalForm.rating;

        let artPath = pendingArtPath;
        if (selectedCoverUrl) {
          artPath = (
            await cacheArtFromUrl(selectedCoverUrl, referenceTrack.filePath)
          ).path;
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
          if (metadata.lyricsChanged) {
            notifyTrackLyricsUpdated(referenceTrack.id);
          }
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
        finish();
      }
      return;
    }

    begin(tracks.length);
    setSaveError(null);

    const updated: Track[] = [];
    const missingTracks: Track[] = [];
    const errors: string[] = [];
    let cancelled = false;

    const noteMissing = (track: Track) => {
      missingTracks.push(track);
      errors.push(missingFileErrorDetail(track));
    };

    try {
      for (let i = 0; i < tracks.length; i++) {
        if (isCancelled()) {
          cancelled = true;
          break;
        }

        const track = tracks[i];
        setProgress(i + 1, tracks.length);

        if (await discoverTrackFileMissing(track)) {
          noteMissing(track);
          continue;
        }

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
          if (metadata.lyricsChanged) {
            notifyTrackLyricsUpdated(track.id);
          }
          updated.push(saved);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (isMissingFileError(err)) {
            noteMissing(track);
          } else {
            errors.push(`${track.title}: ${message}`);
          }
        }
      }

      const libraryUpdates = [
        ...updated,
        ...missingTracks.map((track) => withTrackMissingFile(track, true)),
      ];
      if (libraryUpdates.length > 0) {
        updateTracksInLibrary(libraryUpdates);
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
        showBulkTrackMetadataSaveToast({
          total: tracks.length,
          updated: updated.length,
          errors,
        });
      }

      if (updated.length > 0) {
        closeTrackEditor();
      }
    } finally {
      finish();
    }
  };

  const displayArtSrc = useAssetUrl(selectedCoverUrl ? null : pendingArtPath);
  const previewSrc = selectedCoverUrl ?? displayArtSrc;

  const saveLabel = bulkSaveLabel(saving, saveProgress, t);

  const discardDescription = isBulk
    ? t("library:editor.discardBulk", { count: tracks.length })
    : t("library:editor.discardSingle");

  const hasLyrics =
    (form?.lyrics.trim().length ?? 0) > 0 || Boolean(form?.lyricsInstrumental);

  const identityTitle = form?.title.trim() || t("common:untitled");
  const identitySubtitle = [
    form ? parseArtistField(form.artist).join(", ") : "",
    form?.album.trim() ?? "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Modal
      open={isOpen}
      onClose={handleBackdropClick}
      dismissible={!saving && !artPickerOpen}
      size="editor"
      panelClassName="track-editor-modal"
      panelRef={dialogRef}
      labelledBy="track-editor-title"
    >
      {isOpen && form && (
        <>
          <div className="track-editor-modal__content track-editor-modal__content--tabbed">
            <div
              className="track-editor-modal__main"
              inert={discardPrompt || saving || undefined}
            >
              <ModalHeader
                className={isBulk ? undefined : "track-editor__identity-header"}
              >
                {isBulk ? (
                  <ModalHeaderMain>
                    <ModalTitle id="track-editor-title">
                      {t("library:editor.editTracks", { count: tracks.length })}
                    </ModalTitle>
                    <ModalDescription>
                      {t("library:editor.editTracksDescription", {
                        count: tracks.length,
                      })}
                    </ModalDescription>
                  </ModalHeaderMain>
                ) : (
                  <div className="track-editor__identity">
                    <div className="track-editor__identity-art" aria-hidden>
                      {previewSrc ? (
                        <img
                          src={previewSrc}
                          alt=""
                          className="track-editor__identity-art-img"
                        />
                      ) : (
                        <EntityArt
                          artPath={null}
                          className="track-editor__identity-art-placeholder"
                        />
                      )}
                    </div>
                    <ModalHeaderMain className="track-editor__identity-meta">
                      <ModalTitle
                        id="track-editor-title"
                        className="track-editor__identity-title"
                      >
                        {identityTitle}
                      </ModalTitle>
                      {identitySubtitle ? (
                        <p className="track-editor__identity-subtitle">
                          {identitySubtitle}
                        </p>
                      ) : null}
                    </ModalHeaderMain>
                  </div>
                )}
              </ModalHeader>

              <Tabs
                value={activeTab}
                onChange={(tab) => setActiveTab(tab as TrackEditorTab)}
                className="track-editor__tabs"
                variant="underline"
              >
                <div className="track-editor__tab-bar">
                  <TabList aria-label={t("library:editor.tabsAria")}>
                    <Tab value="details">{t("library:editor.tabDetails")}</Tab>
                    <Tab value="art">{t("library:editor.tabArt")}</Tab>
                    <Tab value="lyrics" badge={hasLyrics ? "•" : undefined}>
                      {t("library:editor.tabLyrics")}
                    </Tab>
                    {!isBulk ? (
                      <Tab value="file">{t("library:editor.tabFile")}</Tab>
                    ) : null}
                  </TabList>
                </div>

                <ModalBody className="track-editor__tab-body">
                  <div className="track-editor__tab-stage">
                    <TabPanel
                      value="details"
                      className="track-editor__tab-panel"
                    >
                      <TrackEditorDetailsTab
                        form={form}
                        tracks={tracks}
                        isBulk={isBulk}
                        onFieldChange={setField}
                        onRatingChange={setRating}
                        artistSuggestions={artistSuggestions}
                        genreSuggestions={genreSuggestions}
                        albumSuggestions={albumSuggestions}
                      />
                    </TabPanel>

                    <TabPanel value="art" className="track-editor__tab-panel">
                      <AlbumEditorArtTab
                        previewSrc={previewSrc}
                        artDragOver={artDragOver}
                        fetchingArt={fetchingArt}
                        onArtDragOver={setArtDragOver}
                        onArtDrop={(e) => void handleArtDrop(e)}
                        onChangeArt={() => void handleChangeArt()}
                        onFetchArt={() => void handleFetchArt()}
                      />
                    </TabPanel>

                    <TabPanel
                      value="lyrics"
                      className="track-editor__tab-panel track-editor__tab-panel--lyrics"
                    >
                      <TrackEditorLyricsTab
                        value={form.lyrics}
                        syncedLines={form.lyricsSyncedLines}
                        instrumental={form.lyricsInstrumental}
                        bulk={isBulk}
                        instrumentalMixed={isLyricsInstrumentalMixed(tracks)}
                        fetchingLyrics={
                          !isBulk && (lyricsFetchPending || committingLyrics)
                        }
                        fetchFeedback={isBulk ? null : lyricsFetchFeedback}
                        onFetchLyrics={() => void handleFetchLyrics()}
                        onInstrumentalChange={setLyricsInstrumental}
                        onChange={setLyrics}
                      />
                    </TabPanel>

                    {!isBulk && referenceTrack ? (
                      <TabPanel
                        value="file"
                        className="track-editor__tab-panel"
                      >
                        <TrackEditorFileTab
                          track={referenceTrack}
                          updateTrackInLibrary={updateTrackInLibrary}
                        />
                      </TabPanel>
                    ) : null}
                  </div>

                  {saveError ? (
                    <p className="track-editor__error" role="alert">
                      {saveError}
                    </p>
                  ) : null}
                </ModalBody>
              </Tabs>
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
            description={discardDescription}
            onKeepEditing={dismissDiscardPrompt}
            onDiscard={closeTrackEditor}
          />

          <AlbumArtPicker
            open={artPickerOpen}
            artType="front"
            subtitle={[
              form.albumArtist.trim() ||
                parseArtistField(form.artist).join(", "),
              form.album.trim(),
            ]
              .filter(Boolean)
              .join(" • ")}
            candidates={coverCandidates}
            selectedUrl={selectedCoverUrl}
            fetching={fetchingArt}
            fetchMessage={fetchMessage}
            onSelect={handleSelectCover}
            onClose={closeArtPicker}
          />

          <LyricsCandidatePicker
            open={lyricsCandidates.length > 1}
            candidates={lyricsCandidates}
            libraryTrack={lyricsLibraryTrack}
            onSelect={handleSelectLyricsCandidate}
            onClose={handleDismissLyricsCandidates}
          />
        </>
      )}
    </Modal>
  );
}
