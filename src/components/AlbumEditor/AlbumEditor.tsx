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
  albumToForm,
  buildTrackAlbumMetadata,
  type AlbumEditorForm,
} from "../../lib/albumMetadata";
import {
  albumKey,
  getAlbumByKey,
  groupTracksIntoAlbums,
} from "../../lib/albums";
import { preloadCoverArtThumbs } from "../../lib/coverArtThumbs";
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

type AlbumEditorTab = "details" | "art";

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
  const [activeTab, setActiveTab] = useState<AlbumEditorTab>("details");
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
  const [artPickerOpen, setArtPickerOpen] = useState(false);
  const artFetchGenRef = useRef(0);

  const isOpen = editingAlbumKey != null && album != null && form != null;

  useFocusTrap(dialogRef, isOpen);

  useEffect(() => {
    if (!album) return;
    const initial = albumToForm(album);
    setActiveTab("details");
    setForm(initial);
    setOriginalForm(initial);
    setPendingArtPath(album.artPath);
    setOriginalArtPath(album.artPath);
    setArtSourcePath(null);
    setCoverCandidates([]);
    setSelectedCoverUrl(null);
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
      const candidates = await fetchCoverArt(form.artist, form.title);
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

  const identityTitle = form?.title.trim() || t("common:untitled");
  const identitySubtitle = form?.artist.trim() ?? "";

  return (
    <Modal
      open={isOpen}
      onClose={handleBackdropClick}
      dismissible={!saving && !artPickerOpen}
      size="editor"
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
                <div className="track-editor__tab-bar">
                  <TabList aria-label={t("library:editor.albumTabsAria")}>
                    <Tab value="details">{t("library:editor.tabDetails")}</Tab>
                    <Tab value="art">{t("library:editor.tabArt")}</Tab>
                  </TabList>
                </div>

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

          <AlbumArtPicker
            open={artPickerOpen}
            artType="front"
            subtitle={[form.artist.trim(), form.title.trim()]
              .filter(Boolean)
              .join(" • ")}
            candidates={coverCandidates}
            selectedUrl={selectedCoverUrl}
            fetching={fetchingArt}
            fetchMessage={fetchMessage}
            onSelect={handleSelectCover}
            onClose={closeArtPicker}
          />
        </>
      )}
    </Modal>
  );
}
