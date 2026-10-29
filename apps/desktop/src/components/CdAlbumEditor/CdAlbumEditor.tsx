import { useEffect, useMemo, useRef, useState } from "react";
import { useArtFileDrop } from "../../hooks/useArtFileDrop";
import { useAssetUrl } from "../../hooks/useAssetUrl";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useResetOnOpen } from "../../hooks/useResetOnOpen";
import { useEditorDiscardPrompt } from "../../hooks/useEditorDiscardPrompt";
import {
  cdArtCacheKey,
  discOverridePatchFromAlbumForm,
} from "../../lib/cdOverrideFromForm";
import { mergeDiscDisplayLayers } from "../../lib/cdMetadata";
import { cdSidebarDiscLabel } from "../../lib/cdTracks";
import { t } from "../../lib/i18n";
import { fetchCoverArtCandidates } from "../../lib/albumArtFetch";
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
} from "../../lib/tauri";
import type {
  MusicBrainzEntityLookup,
  MusicBrainzTrackSlot,
} from "../../types/musicbrainz";
import { useCdStore } from "../../store/useCdStore";
import type { CoverArtCandidate } from "../../types/coverArt";
import { AlbumArtPicker } from "../AlbumEditor/AlbumArtPicker";
import { AlbumEditorArtTab } from "../AlbumEditor/AlbumEditorArtTab";
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
import { Button } from "../common/Button/Button";
import { FormField } from "../common/Field/Field";
import { TextInput } from "../common/TextInput/TextInput";
import { Tab, TabList, TabPanel, Tabs } from "../common/Tabs/Tabs";
import { MusicBrainzEditorTab } from "../MusicBrainzEditorTab/MusicBrainzEditorTab";
import "../TrackEditor/TrackEditor.css";

type CdAlbumEditorTab = "details" | "art" | "musicbrainz";

interface CdAlbumEditorForm {
  title: string;
  artist: string;
  year: string;
  genre: string;
  releaseMbid: string;
}

function formsEqual(a: CdAlbumEditorForm, b: CdAlbumEditorForm): boolean {
  return (
    a.title === b.title &&
    a.artist === b.artist &&
    a.year === b.year &&
    a.genre === b.genre &&
    a.releaseMbid === b.releaseMbid
  );
}

// Previews are staged in the app-data art cache and only written to their
// real destination when the editor saves.
const ART_PREVIEW_KEY = "staging:cd-album-editor";

export function CdAlbumEditor() {
  const editingCdAlbumDriveId = useCdStore((s) => s.editingCdAlbumDriveId);
  const cdAlbumEditorInitialTab = useCdStore((s) => s.cdAlbumEditorInitialTab);
  const cdAlbumEditorAutoOpenMbSearch = useCdStore(
    (s) => s.cdAlbumEditorAutoOpenMbSearch,
  );
  const clearCdAlbumEditorAutoOpenMbSearch = useCdStore(
    (s) => s.clearCdAlbumEditorAutoOpenMbSearch,
  );
  const closeCdAlbumEditor = useCdStore((s) => s.closeCdAlbumEditor);
  const saveDiscOverride = useCdStore((s) => s.saveDiscOverride);
  const discsByDriveId = useCdStore((s) => s.discsByDriveId);
  const metadataByDriveId = useCdStore((s) => s.metadataByDriveId);
  const overridesByDriveId = useCdStore((s) => s.overridesByDriveId);
  const heroArtByDriveId = useCdStore((s) => s.heroArtByDriveId);

  const disc = useMemo(() => {
    if (editingCdAlbumDriveId == null) return null;
    const raw = discsByDriveId[editingCdAlbumDriveId];
    if (raw == null) return null;
    return mergeDiscDisplayLayers(
      raw,
      metadataByDriveId[editingCdAlbumDriveId],
      overridesByDriveId[editingCdAlbumDriveId],
    );
  }, [
    editingCdAlbumDriveId,
    discsByDriveId,
    metadataByDriveId,
    overridesByDriveId,
  ]);

  const discId = disc?.discId?.trim() || null;
  const artPath =
    (editingCdAlbumDriveId != null &&
      (overridesByDriveId[editingCdAlbumDriveId]?.artPath?.trim() ||
        heroArtByDriveId[editingCdAlbumDriveId])) ||
    null;

  const dialogRef = useRef<HTMLDivElement>(null);
  const [activeTab, setActiveTab] = useState<CdAlbumEditorTab>("details");
  const [form, setForm] = useState<CdAlbumEditorForm | null>(null);
  const [originalForm, setOriginalForm] = useState<CdAlbumEditorForm | null>(
    null,
  );
  const [pendingArtPath, setPendingArtPath] = useState<string | null>(null);
  const [originalArtPath, setOriginalArtPath] = useState<string | null>(null);
  const [artSourcePath, setArtSourcePath] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
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

  const isOpen = editingCdAlbumDriveId != null && disc != null && form != null;
  useResetOnOpen(isOpen, cdAlbumEditorInitialTab, activeTab, setActiveTab);

  useFocusTrap(dialogRef, isOpen);

  useEffect(() => {
    if (!disc || editingCdAlbumDriveId == null) {
      setForm(null);
      setOriginalForm(null);
      return;
    }
    const initial: CdAlbumEditorForm = {
      title: disc.album?.trim() || "",
      artist: disc.artist?.trim() || "",
      year: disc.year != null ? String(disc.year) : "",
      genre: disc.genre?.trim() || "",
      releaseMbid: disc.releaseMbid?.trim() || "",
    };
    setActiveTab(cdAlbumEditorInitialTab);
    setForm(initial);
    setOriginalForm(initial);
    setPendingArtPath(artPath);
    setOriginalArtPath(artPath);
    setArtSourcePath(null);
    setCoverCandidates([]);
    setSelectedCoverUrl(null);
    setSelectedCoverPreviewSrc(null);
    setFetchMessage(null);
    setArtPickerOpen(false);
    artFetchGenRef.current += 1;
    setSaveError(null);
    setDiscardPrompt(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key-gated form reset
  }, [editingCdAlbumDriveId, disc?.discId]);

  const artChanged =
    pendingArtPath !== originalArtPath ||
    selectedCoverUrl != null ||
    artSourcePath != null;

  const hasChanges =
    form != null &&
    originalForm != null &&
    (!formsEqual(form, originalForm) || artChanged);

  const {
    discardPrompt,
    setDiscardPrompt,
    requestClose,
    handleBackdropClick,
    dismissDiscardPrompt,
  } = useEditorDiscardPrompt(hasChanges, closeCdAlbumEditor);

  const setField = (field: keyof CdAlbumEditorForm, value: string) => {
    setForm((prev) => (prev ? { ...prev, [field]: value } : prev));
  };

  const applyArtPath = async (sourcePath: string) => {
    if (!discId) {
      setSaveError(t("library:cd.editor.missingDiscId"));
      return;
    }
    setSaveError(null);
    try {
      const cached = await cacheArtFromFile(sourcePath, ART_PREVIEW_KEY);
      setArtSourcePath(sourcePath);
      setSelectedCoverUrl(null);
      setSelectedCoverPreviewSrc(null);
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
    const file = e.dataTransfer.files[0];
    if (!file || !file.type.startsWith("image/")) return;
    const path = (file as File & { path?: string }).path;
    if (path) {
      await applyArtPath(path);
      return;
    }
    setSaveError(t("library:editor.dropArtFailed"));
  };

  useArtFileDrop(isOpen && disc != null, applyArtPath);

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

  const handleSelectCover = (url: string) => {
    setSaveError(null);
    setSelectedCoverUrl(url);
    setSelectedCoverPreviewSrc(previewSrcForFetchedCover(url, coverCandidates));
    setArtSourcePath(null);
    setArtPickerOpen(false);
    setCoverCandidates([]);
    setFetchMessage(null);
  };

  const resolveArtPath = async (): Promise<string | null> => {
    if (!discId) return pendingArtPath;
    if (selectedCoverUrl) {
      return (await cacheArtFromUrl(selectedCoverUrl, cdArtCacheKey(discId)))
        .path;
    }
    if (artSourcePath) {
      return cacheArtFromFile(artSourcePath, cdArtCacheKey(discId));
    }
    return pendingArtPath;
  };

  const stampRecordingsFromReleaseLookup = async (
    lookup: MusicBrainzEntityLookup,
  ) => {
    if (
      !form ||
      !originalForm ||
      disc == null ||
      editingCdAlbumDriveId == null
    ) {
      return;
    }
    if (form.releaseMbid !== originalForm.releaseMbid) return;
    const release = form.releaseMbid.trim();
    if (!release || lookup.hit.mbid !== release) return;
    const tracklist = lookup.tracklist ?? [];
    if (tracklist.length === 0) return;
    if (disc.tracks.every((track) => track.recordingMbid?.trim())) return;

    try {
      const patch = discOverridePatchFromAlbumForm({
        title: form.title,
        artist: form.artist,
        year: form.year,
        genre: form.genre,
        artPath: pendingArtPath,
        artChanged: false,
        releaseMbid: release,
        trackNumbers: disc.tracks.map((track) => track.number),
        tracklist,
      });
      await saveDiscOverride(editingCdAlbumDriveId, patch);
    } catch {
      // Best-effort; album Save can retry.
    }
  };

  const handleSave = async () => {
    if (
      !form ||
      !originalForm ||
      !hasChanges ||
      editingCdAlbumDriveId == null ||
      disc == null
    ) {
      return;
    }
    if (!discId) {
      setSaveError(t("library:cd.editor.missingDiscId"));
      return;
    }

    setSaving(true);
    setSaveError(null);
    try {
      const nextArt = artChanged ? await resolveArtPath() : pendingArtPath;
      const releaseChanged = form.releaseMbid !== originalForm.releaseMbid;
      let tracklist: MusicBrainzTrackSlot[] | null = null;
      let stampRelease = releaseChanged;
      if (releaseChanged && form.releaseMbid.trim()) {
        try {
          const lookup = await getOrFetchMusicBrainzEntity(
            "release",
            form.releaseMbid.trim(),
          );
          if (lookup == null) {
            setSaveError(t("library:editor.musicBrainz.notFound"));
            return;
          }
          tracklist = lookup.tracklist ?? [];
        } catch {
          setSaveError(t("library:editor.musicBrainz.lookupError"));
          return;
        }
      } else if (
        form.releaseMbid.trim() &&
        disc.tracks.some((track) => !track.recordingMbid?.trim())
      ) {
        try {
          const cached = await getMusicBrainzEntity(
            "release",
            form.releaseMbid.trim(),
          );
          if (cached?.tracklist != null && cached.tracklist.length > 0) {
            tracklist = cached.tracklist;
            stampRelease = true;
          }
        } catch {
          // Leave recordings alone if cache read fails.
        }
      }
      const patch = discOverridePatchFromAlbumForm({
        title: form.title,
        artist: form.artist,
        year: form.year,
        genre: form.genre,
        artPath: nextArt,
        artChanged,
        ...(stampRelease
          ? {
              releaseMbid: form.releaseMbid,
              trackNumbers: disc.tracks.map((track) => track.number),
              tracklist: form.releaseMbid.trim() ? tracklist : null,
            }
          : {}),
      });
      await saveDiscOverride(editingCdAlbumDriveId, patch);
      setDiscardPrompt(false);
      closeCdAlbumEditor();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSaveError(message);
    } finally {
      setSaving(false);
    }
  };

  const displayArtSrc = useAssetUrl(selectedCoverUrl ? null : pendingArtPath);
  const previewSrc = selectedCoverPreviewSrc ?? displayArtSrc;
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
      labelledBy="cd-album-editor-title"
    >
      {isOpen && form ? (
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
                      id="cd-album-editor-title"
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
                onChange={(tab) => setActiveTab(tab as CdAlbumEditorTab)}
                className="track-editor__tabs"
                variant="underline"
              >
                <TabList
                  fade
                  aria-label={t("library:editor.cdAlbumTabsAria")}
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
                        <FormField label={t("library:editor.fields.album")}>
                          <TextInput
                            value={form.title}
                            onChange={(e) => setField("title", e.target.value)}
                          />
                        </FormField>
                        <FormField
                          label={t("library:editor.fields.albumArtist")}
                        >
                          <TextInput
                            value={form.artist}
                            onChange={(e) => setField("artist", e.target.value)}
                          />
                        </FormField>
                        <FormField label={t("library:editor.fields.year")}>
                          <TextInput
                            type="number"
                            value={form.year}
                            onChange={(e) => setField("year", e.target.value)}
                          />
                        </FormField>
                        <FormField label={t("library:editor.fields.genre")}>
                          <TextInput
                            value={form.genre}
                            onChange={(e) => setField("genre", e.target.value)}
                          />
                        </FormField>
                      </div>
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
                      value="musicbrainz"
                      className="track-editor__tab-panel"
                      keepMounted
                    >
                      <MusicBrainzEditorTab
                        key={disc?.discId ?? editingCdAlbumDriveId}
                        kind="release"
                        mbid={form.releaseMbid}
                        onMbidChange={(value) => setField("releaseMbid", value)}
                        onEntityLookup={(lookup) => {
                          void stampRecordingsFromReleaseLookup(lookup);
                        }}
                        searchQuery={form.title}
                        searchArtist={form.artist}
                        autoOpenSearch={cdAlbumEditorAutoOpenMbSearch}
                        onAutoOpenSearchConsumed={
                          clearCdAlbumEditorAutoOpenMbSearch
                        }
                      />
                    </TabPanel>
                  </div>

                  {saveError ? (
                    <p className="track-editor__error" role="alert">
                      {saveError}
                    </p>
                  ) : null}
                </ModalBody>
              </Tabs>
            </div>

            <ModalFooter
              fade
              inert={discardPrompt || undefined}
              onCancel={requestClose}
              cancelDisabled={saving}
              cancelLabel={t("common:cancel")}
            >
              <Button
                variant="primary"
                onClick={() => void handleSave()}
                disabled={!hasChanges || saving || discardPrompt || !discId}
              >
                {saving ? t("library:cd.editor.saving") : t("common:save")}
              </Button>
            </ModalFooter>
          </div>

          <EditorDiscardOverlay
            open={discardPrompt}
            description={t("library:cd.editor.discardAlbum", {
              title: cdSidebarDiscLabel(disc),
            })}
            onKeepEditing={dismissDiscardPrompt}
            onDiscard={closeCdAlbumEditor}
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
      ) : null}
    </Modal>
  );
}
