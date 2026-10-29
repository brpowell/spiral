import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ImageCropModal } from "../common/ImageCropModal/ImageCropModal";
import type { ImageCrop } from "../../lib/imageCrop";
import { useArtFileDrop } from "../../hooks/useArtFileDrop";
import { useAssetUrl } from "../../hooks/useAssetUrl";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useResetOnOpen } from "../../hooks/useResetOnOpen";
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
  isReleaseMbidMixed,
  type AlbumEditorForm,
  type AlbumReleaseRecordingOptions,
} from "../../lib/albumMetadata";
import {
  albumKey,
  getAlbumByKey,
  groupTracksIntoAlbums,
} from "../../lib/albums";
import { fetchCoverArtCandidates } from "../../lib/albumArtFetch";
import { refreshArtDisplay } from "../../lib/artDisplayCache";
import { isAlbumArtOverride } from "../../lib/artistArt";
import {
  preloadCoverArtThumbs,
  previewSrcForFetchedCover,
} from "../../lib/coverArtThumbs";
import {
  cacheArtFromFile,
  cacheArtFromUrl,
  getMusicBrainzEntity,
  getOrFetchMusicBrainzEntity,
  pickImageFile,
  renameAlbumArtwork,
  writeTrackMetadata,
} from "../../lib/tauri";
import { matchRecordingMbid } from "../../lib/musicBrainzReleaseRecordings";
import type { MusicBrainzEntityLookup } from "../../types/musicbrainz";
import { collectGenreSuggestions } from "../../lib/trackFieldSuggestions";
import { useNavigationStore } from "../../store/useNavigationStore";
import { usePlayerStore } from "../../store/usePlayerStore";
import type { CoverArtCandidate } from "../../types/coverArt";
import type { Track } from "../../types/track";
import { AlertConfirmation } from "../common/AlertConfirmation/AlertConfirmation";
import { EditorSaveButton } from "../EditorSaveButton/EditorSaveButton";
import { EntityArt } from "../EntityArt/EntityArt";
import { EditorDiscardOverlay } from "../EditorDiscardOverlay/EditorDiscardOverlay";
import {
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalHeaderMain,
  ModalTitle,
} from "../common/Modal/Modal";
import { Tab, TabList, TabPanel, Tabs } from "../common/Tabs/Tabs";
import "../TrackEditor/TrackEditor.css";
import { AlbumArtPicker } from "./AlbumArtPicker";
import { AlbumEditorArtTab } from "./AlbumEditorArtTab";
import { AlbumEditorDetailsTab } from "./AlbumEditorDetailsTab";
import { MusicBrainzEditorTab } from "../MusicBrainzEditorTab/MusicBrainzEditorTab";
import { showTagWriteSavedToast } from "../../lib/trackMetadataToast";
import { useTagWriteConfirmStore } from "../../store/useTagWriteConfirmStore";

type AlbumEditorTab = "details" | "art" | "musicbrainz";

// Previews and fetched covers are staged in the app-data art cache and only
// written to the library when the editor saves.
const ART_PREVIEW_KEY = "staging:album-editor";
const ART_DOWNLOAD_KEY = "staging:album-editor-download";

export function AlbumEditor() {
  const { t } = useTranslation(["library", "common"]);
  const editingAlbumKey = usePlayerStore((s) => s.editingAlbumKey);
  const albumEditorInitialTab = usePlayerStore((s) => s.albumEditorInitialTab);
  const albumEditorAutoOpenMbSearch = usePlayerStore(
    (s) => s.albumEditorAutoOpenMbSearch,
  );
  const clearAlbumEditorAutoOpenMbSearch = usePlayerStore(
    (s) => s.clearAlbumEditorAutoOpenMbSearch,
  );
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
  const [activeTab, setActiveTab] = useState<AlbumEditorTab>("details");
  const [form, setForm] = useState<AlbumEditorForm | null>(null);
  const [originalForm, setOriginalForm] = useState<AlbumEditorForm | null>(
    null,
  );
  const [pendingArtPath, setPendingArtPath] = useState<string | null>(null);
  const [originalArtPath, setOriginalArtPath] = useState<string | null>(null);
  const [artSourcePath, setArtSourcePath] = useState<string | null>(null);
  const [artCrop, setArtCrop] = useState<ImageCrop | null>(null);
  const [artMaxEdge, setArtMaxEdge] = useState<number | null>(null);
  const [cropFromFetch, setCropFromFetch] = useState(false);
  const [cropInitial, setCropInitial] = useState<ImageCrop | null>(null);
  const [cropInitialMaxEdge, setCropInitialMaxEdge] = useState<number | null>(
    null,
  );
  const [loadingCoverUrl, setLoadingCoverUrl] = useState<string | null>(null);
  const [cropApplying, setCropApplying] = useState(false);
  const cropFetchRef = useRef(0);
  const [cropModalSourcePath, setCropModalSourcePath] = useState<string | null>(
    null,
  );
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
  const [selectedCoverPreviewSrc, setSelectedCoverPreviewSrc] = useState<
    string | null
  >(null);
  const [fetchMessage, setFetchMessage] = useState<string | null>(null);
  const [artDragOver, setArtDragOver] = useState(false);
  const [artPickerOpen, setArtPickerOpen] = useState(false);
  const [overwriteOverridesOpen, setOverwriteOverridesOpen] = useState(false);
  const artFetchGenRef = useRef(0);

  const isOpen = editingAlbumKey != null && album != null && form != null;
  useResetOnOpen(isOpen, albumEditorInitialTab, activeTab, setActiveTab);

  useFocusTrap(dialogRef, isOpen);

  useEffect(() => {
    if (!album) {
      setForm(null);
      setOriginalForm(null);
      return;
    }
    const initial = albumToForm(album);
    setActiveTab(albumEditorInitialTab);
    setForm(initial);
    setOriginalForm(initial);
    setPendingArtPath(album.artPath);
    setOriginalArtPath(album.artPath);
    setArtSourcePath(null);
    setArtCrop(null);
    setArtMaxEdge(null);
    setCoverCandidates([]);
    setSelectedCoverUrl(null);
    setSelectedCoverPreviewSrc(null);
    setFetchMessage(null);
    setArtPickerOpen(false);
    artFetchGenRef.current += 1;
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

  const applyArtPath = async (
    sourcePath: string,
    crop: ImageCrop | null,
    maxEdge: number | null = null,
  ) => {
    if (!referenceTrack) return;
    setSaveError(null);
    try {
      const cached = await cacheArtFromFile(
        sourcePath,
        ART_PREVIEW_KEY,
        crop,
        maxEdge,
      );
      setArtSourcePath(sourcePath);
      setArtCrop(crop);
      setArtMaxEdge(maxEdge);
      setSelectedCoverUrl(null);
      setSelectedCoverPreviewSrc(null);
      // The preview path is reused, so drop any URL cached for the last image.
      refreshArtDisplay([cached]);
      setPendingArtPath(cached);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSaveError(message);
    }
  };

  // Re-crop from the original source when there is one, so the previous crop
  // can be adjusted instead of cropping an already-cropped preview.
  const handleEditArt = () => {
    if (artSourcePath) {
      setCropInitial(artCrop);
      setCropInitialMaxEdge(artMaxEdge);
      setCropModalSourcePath(artSourcePath);
    } else if (pendingArtPath) {
      setCropInitial(null);
      setCropInitialMaxEdge(null);
      setCropModalSourcePath(pendingArtPath);
    }
  };

  const handleChangeArt = async () => {
    const path = await pickImageFile();
    if (path) setCropModalSourcePath(path);
  };

  const handleArtDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setArtDragOver(false);
    if (!referenceTrack) return;

    const file = e.dataTransfer.files[0];
    if (!file || !file.type.startsWith("image/")) return;

    const path = (file as File & { path?: string }).path;
    if (path) {
      setCropModalSourcePath(path);
      return;
    }

    setSaveError(t("library:editor.dropArtFailed"));
  };

  useArtFileDrop(isOpen && !!referenceTrack, setCropModalSourcePath);

  const closeArtPicker = () => {
    artFetchGenRef.current += 1;
    cropFetchRef.current += 1;
    setLoadingCoverUrl(null);
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
      const candidates = await fetchCoverArtCandidates({
        artist: form.artist,
        album: form.title,
        releaseMbid: form.releaseMbid.trim() || null,
      });
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

  const closeCropModal = () => {
    cropFetchRef.current += 1;
    setCropModalSourcePath(null);
    setCropInitial(null);
    setCropInitialMaxEdge(null);
    setCropFromFetch(false);
  };

  const handleCropCancel = () => {
    const source = cropFromFetch ? cropModalSourcePath : null;
    closeCropModal();
    // Keep the full-quality cover the user picked, uncropped.
    if (source) void applyArtPath(source, null);
  };

  const handleCropApply = async (crop: ImageCrop, maxEdge: number | null) => {
    const source = cropModalSourcePath;
    if (!source) return;
    setCropApplying(true);
    try {
      await applyArtPath(source, crop, maxEdge);
    } finally {
      setCropApplying(false);
      closeCropModal();
    }
  };

  const handleSelectCover = async (url: string) => {
    setSaveError(null);
    setArtSourcePath(null);
    setArtCrop(null);
    setArtMaxEdge(null);
    if (!referenceTrack) {
      setArtPickerOpen(false);
      setCoverCandidates([]);
      setFetchMessage(null);
      setSelectedCoverUrl(url);
      setSelectedCoverPreviewSrc(
        previewSrcForFetchedCover(url, coverCandidates),
      );
      return;
    }
    // Stage the full-quality cover while the picker shows a spinner on the
    // chosen thumbnail, then crop it. The art behind the dialogs stays put until
    // they close, so nothing flashes.
    const token = ++cropFetchRef.current;
    setLoadingCoverUrl(url);
    try {
      const { path } = await cacheArtFromUrl(url, ART_DOWNLOAD_KEY);
      if (token !== cropFetchRef.current) return;
      setLoadingCoverUrl(null);
      setArtPickerOpen(false);
      setCoverCandidates([]);
      setFetchMessage(null);
      setCropFromFetch(true);
      setCropModalSourcePath(path);
    } catch (err) {
      if (token !== cropFetchRef.current) return;
      setLoadingCoverUrl(null);
      setSaveError(err instanceof Error ? err.message : String(err));
    }
  };

  const resolveArtPathForTrack = async (
    track: Track,
  ): Promise<string | null> => {
    // Album assign writes one shared front.jpg (keyed by any album track path).
    const cacheKey = referenceTrack?.filePath ?? track.filePath;
    if (selectedCoverUrl) {
      return (await cacheArtFromUrl(selectedCoverUrl, cacheKey)).path;
    }
    if (artSourcePath) {
      return cacheArtFromFile(artSourcePath, cacheKey, artCrop, artMaxEdge);
    }
    return pendingArtPath;
  };

  const tracksWithArtOverrides = useMemo(
    () => tracks.filter((track) => isAlbumArtOverride(track.artPath)),
    [tracks],
  );

  const resolveRecordingOptions =
    async (): Promise<AlbumReleaseRecordingOptions | null> => {
      if (!form || !originalForm) return null;
      const releaseChanged = form.releaseMbid !== originalForm.releaseMbid;
      let recordingOptions: AlbumReleaseRecordingOptions = {
        releaseChanged: false,
      };
      if (releaseChanged) {
        const nextRelease = form.releaseMbid.trim();
        if (nextRelease) {
          try {
            const lookup = await getOrFetchMusicBrainzEntity(
              "release",
              nextRelease,
            );
            if (lookup == null) {
              setSaveError(t("library:editor.musicBrainz.notFound"));
              return null;
            }
            recordingOptions = {
              releaseChanged: true,
              tracklist: lookup.tracklist ?? [],
            };
          } catch {
            setSaveError(t("library:editor.musicBrainz.lookupError"));
            return null;
          }
        } else {
          recordingOptions = { releaseChanged: true, tracklist: null };
        }
      } else if (
        form.releaseMbid.trim() &&
        tracks.some((track) => !track.recordingMbid?.trim())
      ) {
        try {
          const cached = await getMusicBrainzEntity(
            "release",
            form.releaseMbid.trim(),
          );
          if (cached?.tracklist != null && cached.tracklist.length > 0) {
            recordingOptions = {
              releaseChanged: true,
              tracklist: cached.tracklist,
            };
          }
        } catch {
          // Leave recordings alone if cache read fails.
        }
      }
      return recordingOptions;
    };

  const runAlbumSave = async (
    overwriteUniqueArt: boolean,
    recordingOptions: AlbumReleaseRecordingOptions,
  ) => {
    if (!form || !originalForm || !album || tracks.length === 0) return;

    const confirmed = await useTagWriteConfirmStore
      .getState()
      .confirmTagWrite("album", tracks.length);
    if (!confirmed) return;

    begin(tracks.length);
    setSaveError(null);

    const updated: Track[] = [];
    const errors: string[] = [];
    const oldKey = album.key;
    let cancelled = false;
    let sharedArtPath: string | null | undefined;

    try {
      const identityChanged =
        form.title !== originalForm.title ||
        form.artist !== originalForm.artist;
      if (identityChanged) {
        const fallbackArtist = tracks[0]?.artist ?? null;
        await renameAlbumArtwork({
          oldAlbumArtist: originalForm.artist.trim() || null,
          oldArtist: fallbackArtist,
          oldAlbum: originalForm.title.trim() || null,
          newAlbumArtist: form.artist.trim() || null,
          newArtist: fallbackArtist,
          newAlbum: form.title.trim() || null,
        });
      }

      for (let i = 0; i < tracks.length; i++) {
        if (isCancelled()) {
          cancelled = true;
          break;
        }

        const track = tracks[i];
        setProgress(i + 1, tracks.length);
        try {
          const hasOverride = isAlbumArtOverride(track.artPath);
          let artPath = track.artPath;
          let artChangedForTrack = false;
          if (artChanged) {
            if (hasOverride && !overwriteUniqueArt) {
              artPath = track.artPath;
              artChangedForTrack = false;
            } else {
              if (sharedArtPath === undefined) {
                sharedArtPath = await resolveArtPathForTrack(track);
              }
              artPath = sharedArtPath;
              artChangedForTrack = true;
            }
          }
          const metadata = buildTrackAlbumMetadata(
            track,
            form,
            originalForm,
            artPath,
            artChangedForTrack,
            recordingOptions,
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
        if (artChanged) {
          refreshArtDisplay([
            originalArtPath,
            ...updated.map((track) => track.artPath),
          ]);
        }
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
      showTagWriteSavedToast(updated.length);
      closeAlbumEditor();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSaveError(message);
    } finally {
      finish();
    }
  };

  const pendingRecordingOptionsRef = useRef<AlbumReleaseRecordingOptions>({
    releaseChanged: false,
  });

  const handleSave = async () => {
    if (!album || !form || !originalForm || !hasChanges || tracks.length === 0)
      return;

    const recordingOptions = await resolveRecordingOptions();
    if (!recordingOptions) return;
    pendingRecordingOptionsRef.current = recordingOptions;

    if (artChanged && tracksWithArtOverrides.length > 0) {
      setOverwriteOverridesOpen(true);
      return;
    }
    await runAlbumSave(false, recordingOptions);
  };

  /** When Fetch warms a release that is already saved, stamp missing recordings. */
  const stampRecordingsFromReleaseLookup = async (
    lookup: MusicBrainzEntityLookup,
  ) => {
    if (!form || !originalForm || tracks.length === 0) return;
    if (form.releaseMbid !== originalForm.releaseMbid) return;
    const release = form.releaseMbid.trim();
    if (!release || lookup.hit.mbid !== release) return;
    const tracklist = lookup.tracklist ?? [];
    if (tracklist.length === 0) return;

    const updates: Track[] = [];
    for (const track of tracks) {
      const matched = matchRecordingMbid(track, tracklist);
      if (!matched) continue;
      if ((track.recordingMbid?.trim() || "") === matched) continue;
      try {
        const artPath = track.artPath;
        const updated = await writeTrackMetadata(
          track.id,
          track.filePath,
          buildTrackAlbumMetadata(track, form, originalForm, artPath, false, {
            releaseChanged: true,
            tracklist,
          }),
        );
        updates.push(updated);
      } catch {
        // Best-effort backfill; album Save can retry.
      }
    }
    if (updates.length > 0) {
      updateTracksInLibrary(updates);
    }
  };

  const displayArtSrc = useAssetUrl(selectedCoverUrl ? null : pendingArtPath);
  const previewSrc = selectedCoverPreviewSrc ?? displayArtSrc;

  const saveLabel = bulkSaveLabel(saving, saveProgress, t);

  const identityTitle = form?.title.trim() || t("common:untitled");
  const identitySubtitle = form?.artist.trim() ?? "";

  return (
    <Modal
      open={isOpen}
      onClose={handleBackdropClick}
      dismissible={!saving && !artPickerOpen}
      size="editor"
      fitContent
      panelClassName="track-editor-modal"
      panelRef={dialogRef}
      labelledBy="album-editor-title"
    >
      {isOpen && form && (
        <>
          <div className="track-editor-modal__content track-editor-modal__content--tabbed">
            <div
              className="track-editor-modal__main"
              inert={discardPrompt || saving || undefined}
            >
              <ModalHeader className="track-editor__identity-header">
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
                      id="album-editor-title"
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
              </ModalHeader>

              <Tabs
                value={activeTab}
                onChange={(tab) => setActiveTab(tab as AlbumEditorTab)}
                className="track-editor__tabs"
                variant="underline"
              >
                <TabList
                  fade
                  aria-label={t("library:editor.albumTabsAria")}
                  className="track-editor__tab-bar"
                >
                  <Tab value="details">{t("library:editor.tabDetails")}</Tab>
                  <Tab value="art">{t("library:editor.tabArt")}</Tab>
                  <Tab value="musicbrainz">
                    {t("library:editor.tabMusicBrainz")}
                  </Tab>
                </TabList>

                <ModalBody className="track-editor__tab-body">
                  <div className="track-editor__tab-stage">
                    <TabPanel
                      value="details"
                      className="track-editor__tab-panel"
                    >
                      <AlbumEditorDetailsTab
                        form={form}
                        tracks={tracks}
                        genreSuggestions={genreSuggestions}
                        onFieldChange={setField}
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
                        onEditArt={handleEditArt}
                      />
                    </TabPanel>

                    <TabPanel
                      value="musicbrainz"
                      className="track-editor__tab-panel"
                      keepMounted
                    >
                      <MusicBrainzEditorTab
                        key={album?.key}
                        kind="release"
                        mbid={form.releaseMbid}
                        mixed={isReleaseMbidMixed(tracks)}
                        placeholder={albumMixedFieldPlaceholder(
                          tracks,
                          "releaseMbid",
                          form,
                        )}
                        onMbidChange={(value) => setField("releaseMbid", value)}
                        onEntityLookup={(lookup) => {
                          void stampRecordingsFromReleaseLookup(lookup);
                        }}
                        searchQuery={form.title}
                        searchArtist={form.artist}
                        autoOpenSearch={albumEditorAutoOpenMbSearch}
                        onAutoOpenSearchConsumed={
                          clearAlbumEditorAutoOpenMbSearch
                        }
                      />
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
            description={t("library:editor.discardAlbum")}
            onKeepEditing={dismissDiscardPrompt}
            onDiscard={closeAlbumEditor}
          />

          <AlbumArtPicker
            open={artPickerOpen}
            artType="front"
            subtitle={[form.artist.trim(), form.title.trim()]
              .filter(Boolean)
              .join(" • ")}
            candidates={coverCandidates}
            selectedUrl={selectedCoverUrl}
            loadingUrl={loadingCoverUrl}
            fetching={fetchingArt}
            fetchMessage={fetchMessage}
            onSelect={handleSelectCover}
            onClose={closeArtPicker}
          />

          <AlertConfirmation
            open={overwriteOverridesOpen}
            onClose={() => setOverwriteOverridesOpen(false)}
            size="md"
            deferActionUntilClosed
            title={t("library:editor.overwriteUniqueArt.title")}
            confirmLabel={t("library:editor.overwriteUniqueArt.confirm")}
            secondaryLabel={t("library:editor.overwriteUniqueArt.keepUnique")}
            confirmVariant="danger"
            secondaryVariant="secondary"
            onSecondary={async () => {
              await runAlbumSave(false, pendingRecordingOptionsRef.current);
            }}
            onConfirm={async () => {
              await runAlbumSave(true, pendingRecordingOptionsRef.current);
            }}
          >
            <p>
              {t("library:editor.overwriteUniqueArt.body", {
                count: tracksWithArtOverrides.length,
              })}
            </p>
            <ul className="alert-confirmation__track-list">
              {tracksWithArtOverrides.map((track) => (
                <li key={track.id} className="alert-confirmation__track">
                  <div className="alert-confirmation__track-art">
                    <EntityArt artPath={track.artPath} variant="row" alt="" />
                  </div>
                  <span className="alert-confirmation__track-title">
                    {track.title.trim() || t("common:untitled")}
                  </span>
                </li>
              ))}
            </ul>
          </AlertConfirmation>
        </>
      )}
      <ImageCropModal
        open={cropModalSourcePath != null}
        filePath={cropModalSourcePath}
        busy={cropApplying}
        initialCrop={cropInitial}
        initialMaxEdge={cropInitialMaxEdge}
        showSizeOptions
        aspect={1}
        onApply={handleCropApply}
        onClose={handleCropCancel}
      />
    </Modal>
  );
}
