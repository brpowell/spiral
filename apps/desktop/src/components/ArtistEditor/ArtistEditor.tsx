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
import { artistArtCacheKey, applyArtistImages } from "../../lib/artistArt";
import { refreshArtDisplay } from "../../lib/artDisplayCache";
import {
  artistFormsEqual,
  artistKeyAfterRename,
  artistMetadataSaveTargets,
  artistMbidPlaceholder,
  artistToForm,
  buildTrackArtistMetadata,
  isArtistMbidMixed,
  type ArtistEditorForm,
} from "../../lib/artistMetadata";
import { getArtistByKey, groupTracksIntoArtists } from "../../lib/artists";
import {
  preloadCoverArtThumbs,
  previewSrcForFetchedCover,
} from "../../lib/coverArtThumbs";
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
  ModalFooter,
  ModalHeader,
  ModalHeaderMain,
  ModalTitle,
} from "../common/Modal/Modal";
import { FormField } from "../common/Field/Field";
import { TextInput } from "../common/TextInput/TextInput";
import { Tab, TabList, TabPanel, Tabs } from "../common/Tabs/Tabs";
import { AlbumArtPicker } from "../AlbumEditor/AlbumArtPicker";
import { AlbumEditorArtTab } from "../AlbumEditor/AlbumEditorArtTab";
import { MusicBrainzEditorTab } from "../MusicBrainzEditorTab/MusicBrainzEditorTab";
import { showTagWriteSavedToast } from "../../lib/trackMetadataToast";
import { useTagWriteConfirmStore } from "../../store/useTagWriteConfirmStore";
import "../TrackEditor/TrackEditor.css";

type ArtistEditorTab = "details" | "art" | "musicbrainz";

// Previews and fetched covers are staged in the app-data art cache and only
// written to the library when the editor saves.
const ART_PREVIEW_KEY = "staging:artist-editor";
const ART_DOWNLOAD_KEY = "staging:artist-editor-download";

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
  const [activeTab, setActiveTab] = useState<ArtistEditorTab>("details");
  const [form, setForm] = useState<ArtistEditorForm | null>(null);
  const [originalForm, setOriginalForm] = useState<ArtistEditorForm | null>(
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
  const [selectedCoverPreviewSrc, setSelectedCoverPreviewSrc] = useState<
    string | null
  >(null);
  const [fetchMessage, setFetchMessage] = useState<string | null>(null);
  const [artDragOver, setArtDragOver] = useState(false);
  const [artPickerOpen, setArtPickerOpen] = useState(false);
  const artFetchGenRef = useRef(0);

  const isOpen = editingArtistKey != null && artist != null && form != null;
  useResetOnOpen(isOpen, "details", activeTab, setActiveTab);

  useFocusTrap(dialogRef, isOpen);

  useEffect(() => {
    if (!artist) {
      setForm(null);
      setOriginalForm(null);
      return;
    }
    const initial = artistToForm(artist, editingArtistBrowseMode);
    setActiveTab("details");
    setForm(initial);
    setOriginalForm(initial);
    setPendingArtPath(artist.artPath);
    setOriginalArtPath(artist.artPath);
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

  const applyArtPath = async (
    sourcePath: string,
    crop: ImageCrop | null,
    maxEdge: number | null = null,
  ) => {
    if (!artCacheKey) return;
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
      setPendingArtPath(cached);
      refreshArtDisplay([pendingArtPath, cached]);
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
    if (!artCacheKey) return;

    const file = e.dataTransfer.files[0];
    if (!file || !file.type.startsWith("image/")) return;

    const path = (file as File & { path?: string }).path;
    if (path) {
      setCropModalSourcePath(path);
      return;
    }

    setSaveError(t("library:editor.dropArtFailed"));
  };

  useArtFileDrop(isOpen && !!artCacheKey, setCropModalSourcePath);

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
      const candidates = await fetchArtistArt(
        form.name,
        form.artistMbid.trim() || null,
      );
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
    if (!artCacheKey) {
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

  const resolveArtistArtPath = async (
    cacheKey: string,
  ): Promise<string | null> => {
    if (selectedCoverUrl) {
      return (
        await cacheArtFromUrl(selectedCoverUrl, cacheKey, {
          artist: form?.name,
        })
      ).path;
    }
    if (artSourcePath) {
      // The staged preview is already the baked result of the current source,
      // crop and size, so copy it instead of baking again.
      return cacheArtFromFile(
        pendingArtPath ?? artSourcePath,
        cacheKey,
        pendingArtPath ? null : artCrop,
        pendingArtPath ? null : artMaxEdge,
      );
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
    const mbidChanged = form.artistMbid !== originalForm.artistMbid;
    const metadataChanged = nameChanged || mbidChanged;

    const saveTargets = metadataChanged
      ? artistMetadataSaveTargets(tracks, library, oldKey)
      : [];

    if (metadataChanged && saveTargets.length === 0) return;

    if (metadataChanged) {
      const confirmed = await useTagWriteConfirmStore
        .getState()
        .confirmTagWrite("artist", saveTargets.length);
      if (!confirmed) return;
    }

    const updated: Track[] = [];
    const errors: string[] = [];
    let cancelled = false;

    if (metadataChanged) {
      begin(saveTargets.length);
    } else {
      beginQuick();
    }
    setSaveError(null);

    try {
      if (metadataChanged) {
        for (let i = 0; i < saveTargets.length; i++) {
          if (isCancelled()) {
            cancelled = true;
            break;
          }

          const { track, scope } = saveTargets[i];
          setProgress(i + 1, saveTargets.length);
          try {
            const metadata = buildTrackArtistMetadata(
              track,
              form,
              originalForm,
              oldKey,
              browseMode,
              scope,
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
              total: saveTargets.length,
            }),
          );
          return;
        }

        if (errors.length > 0) {
          setSaveError(
            errors.length === saveTargets.length
              ? errors[0]
              : t("library:editor.partialSave", {
                  updated: updated.length,
                  total: saveTargets.length,
                  error: errors[0],
                }),
          );
          return;
        }

        showTagWriteSavedToast(updated.length);

        if (oldKey !== newKey && !artChanged) {
          await renameArtistImageKey(oldKey, newKey);
        }
      }

      if (artChanged) {
        enterQuickPhase();
        const cacheKey = artistArtCacheKey(newKey);
        const finalArtPath = await resolveArtistArtPath(cacheKey);
        await saveArtistImage(newKey, finalArtPath);
        if (nameChanged && oldKey !== newKey) {
          await saveArtistImage(oldKey, null);
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
  const previewSrc = selectedCoverPreviewSrc ?? displayArtSrc;

  const saveLabel = bulkSaveLabel(saving, saveProgress, t);
  const identityTitle = form?.name.trim() || t("common:untitled");
  const artistPlaceholder = <IconArtistPlaceholder />;

  return (
    <Modal
      open={isOpen}
      onClose={handleBackdropClick}
      dismissible={!saving && !artPickerOpen}
      size="editor"
      fitContent
      panelClassName="track-editor-modal track-editor-modal--compact"
      panelRef={dialogRef}
      labelledBy="artist-editor-title"
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
                  <div
                    className="track-editor__identity-art track-editor__identity-art--round"
                    aria-hidden
                  >
                    {previewSrc ? (
                      <img
                        src={previewSrc}
                        alt=""
                        className="track-editor__identity-art-img"
                      />
                    ) : (
                      <EntityArt
                        artPath={null}
                        className="track-editor__identity-art-placeholder album-art--round"
                        placeholder={artistPlaceholder}
                      />
                    )}
                  </div>
                  <ModalHeaderMain className="track-editor__identity-meta">
                    <ModalTitle
                      id="artist-editor-title"
                      className="track-editor__identity-title"
                    >
                      {identityTitle}
                    </ModalTitle>
                  </ModalHeaderMain>
                </div>
              </ModalHeader>

              <Tabs
                value={activeTab}
                onChange={(tab) => setActiveTab(tab as ArtistEditorTab)}
                className="track-editor__tabs"
                variant="underline"
              >
                <TabList
                  fade
                  aria-label={t("library:editor.artistTabsAria")}
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
                    </TabPanel>

                    <TabPanel value="art" className="track-editor__tab-panel">
                      <AlbumEditorArtTab
                        artType="portrait"
                        previewSrc={previewSrc}
                        placeholder={artistPlaceholder}
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
                        key={editingArtistKey ?? artist?.key}
                        kind="artist"
                        mbid={form.artistMbid}
                        mixed={isArtistMbidMixed(
                          tracks,
                          editingArtistKey ?? "",
                          editingArtistBrowseMode,
                        )}
                        placeholder={artistMbidPlaceholder(
                          tracks,
                          editingArtistKey ?? "",
                          editingArtistBrowseMode,
                          form,
                        )}
                        onMbidChange={(value) =>
                          setForm((prev) =>
                            prev ? { ...prev, artistMbid: value } : prev,
                          )
                        }
                        searchQuery={form.name}
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
            description={t("library:editor.discardArtist")}
            onKeepEditing={dismissDiscardPrompt}
            onDiscard={closeArtistEditor}
          />

          <AlbumArtPicker
            open={artPickerOpen}
            artType="portrait"
            subtitle={form.name.trim() || undefined}
            candidates={coverCandidates}
            selectedUrl={selectedCoverUrl}
            loadingUrl={loadingCoverUrl}
            fetching={fetchingArt}
            fetchMessage={fetchMessage}
            onSelect={handleSelectCover}
            onClose={closeArtPicker}
          />
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
        round
        onApply={handleCropApply}
        onClose={handleCropCancel}
      />
    </Modal>
  );
}
