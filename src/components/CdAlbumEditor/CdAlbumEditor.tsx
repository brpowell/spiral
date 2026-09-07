import { useEffect, useMemo, useRef, useState } from "react";
import { useArtFileDrop } from "../../hooks/useArtFileDrop";
import { useAssetUrl } from "../../hooks/useAssetUrl";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useEditorDiscardPrompt } from "../../hooks/useEditorDiscardPrompt";
import {
  cdArtCacheKey,
  discOverridePatchFromAlbumForm,
} from "../../lib/cdOverrideFromForm";
import { mergeDiscDisplayLayers } from "../../lib/cdMetadata";
import { cdSidebarDiscLabel } from "../../lib/cdTracks";
import { formatBytes, formatDimensions } from "../../lib/formatBytes";
import { t } from "../../lib/i18n";
import { fetchCoverArtCandidates } from "../../lib/albumArtFetch";
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
import { EntityArt } from "../EntityArt/EntityArt";
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
import { Button } from "../common/Button/Button";
import { FormField } from "../common/Field/Field";
import { TextInput } from "../common/TextInput/TextInput";
import { Tab, TabList, TabPanel, Tabs } from "../common/Tabs/Tabs";
import { MusicBrainzEditorTab } from "../MusicBrainzEditorTab/MusicBrainzEditorTab";
import "../TrackEditor/TrackEditor.css";

type CdAlbumEditorTab = "details" | "musicbrainz";

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
      {meta || t("library:editor.loadingDetails")}
    </span>
  );
}

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
  const [fetchMessage, setFetchMessage] = useState<string | null>(null);
  const [artDragOver, setArtDragOver] = useState(false);

  const isOpen = editingCdAlbumDriveId != null && disc != null && form != null;

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
    setFetchMessage(null);
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
      const cached = await cacheArtFromFile(sourcePath, cdArtCacheKey(discId));
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
    const file = e.dataTransfer.files[0];
    if (!file || !file.type.startsWith("image/")) return;
    const path = (file as File & { path?: string }).path;
    if (path) {
      await applyArtPath(path);
      return;
    }
    setSaveError(t("library:cd.editor.dropArtFailed"));
  };

  useArtFileDrop(isOpen && disc != null, applyArtPath);

  const handleFetchArt = async () => {
    if (!form) return;
    setFetchingArt(true);
    setFetchMessage(null);
    setCoverCandidates([]);
    setSelectedCoverUrl(null);
    setSaveError(null);
    try {
      const candidates = await fetchCoverArtCandidates({
        artist: form.artist,
        album: form.title,
        releaseMbid: form.releaseMbid.trim() || null,
      });
      if (candidates.length === 0) {
        setFetchMessage(t("library:cd.editor.noArtResults"));
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
  const previewSrc = selectedCoverUrl ?? displayArtSrc;
  const trackCount = disc?.tracks.length ?? 0;

  return (
    <Modal
      open={isOpen}
      onClose={handleBackdropClick}
      size="editor"
      panelClassName="track-editor-modal"
      panelRef={dialogRef}
      labelledBy="cd-album-editor-title"
    >
      {isOpen && form ? (
        <>
          <div
            className="track-editor-modal__content track-editor-modal__content--tabbed"
            inert={discardPrompt || undefined}
          >
            <ModalHeader>
              <ModalHeaderMain>
                <ModalTitle id="cd-album-editor-title">
                  {t("library:cd.editor.editAlbum")}
                </ModalTitle>
                <ModalDescription>
                  {t("library:cd.editor.editAlbumDescription", {
                    count: trackCount,
                  })}
                </ModalDescription>
              </ModalHeaderMain>
            </ModalHeader>

            <Tabs
              value={activeTab}
              onChange={(tab) => setActiveTab(tab as CdAlbumEditorTab)}
              className="track-editor__tabs"
              variant="underline"
            >
              <div className="track-editor__tab-bar">
                <TabList aria-label={t("library:editor.cdAlbumTabsAria")}>
                  <Tab value="details">{t("library:editor.tabDetails")}</Tab>
                  <Tab value="musicbrainz">
                    {t("library:editor.tabMusicBrainz")}
                  </Tab>
                </TabList>
              </div>

              <ModalBody className="track-editor__tab-body">
                <div className="track-editor__tab-stage">
                  <TabPanel value="details" className="track-editor__tab-panel">
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
                          onDrop={(e) => void handleArtDrop(e)}
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
                          {t("library:cd.editor.addArt")}
                        </Button>
                        <Button
                          size="sm"
                          className="track-editor__art-btn"
                          onClick={() => void handleFetchArt()}
                          disabled={fetchingArt}
                        >
                          {fetchingArt
                            ? t("library:cd.editor.fetchingArt")
                            : t("library:cd.editor.fetchArt")}
                        </Button>
                        {fetchMessage && !fetchingArt ? (
                          <p className="track-editor__fetch-msg">
                            {fetchMessage}
                          </p>
                        ) : null}
                        {fetchingArt ? (
                          <div
                            className="track-editor__fetching"
                            role="status"
                            aria-live="polite"
                          >
                            <span
                              className="track-editor__fetching-spinner"
                              aria-hidden
                            />
                            <span>
                              {t("library:cd.editor.fetchingArtStatus")}
                            </span>
                          </div>
                        ) : null}
                        {coverCandidates.length > 0 ? (
                          <div
                            className="track-editor__cover-picker"
                            aria-label={t("library:cd.editor.coverOptions")}
                          >
                            {coverCandidates.map((candidate) => {
                              const thumbSrc =
                                candidate.thumbnailUrl ?? candidate.url;
                              return (
                                <button
                                  key={candidate.url}
                                  type="button"
                                  className={
                                    selectedCoverUrl === candidate.url
                                      ? "track-editor__cover-option track-editor__cover-option--selected"
                                      : "track-editor__cover-option"
                                  }
                                  onClick={() =>
                                    handleSelectCover(candidate.url)
                                  }
                                  aria-pressed={
                                    selectedCoverUrl === candidate.url
                                  }
                                >
                                  <span className="track-editor__cover-thumb">
                                    <img src={thumbSrc} alt="" loading="lazy" />
                                  </span>
                                  <CoverOptionMeta candidate={candidate} />
                                </button>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>

                      <div className="track-editor__fields">
                        <FormField label={t("library:cd.editor.album")}>
                          <TextInput
                            value={form.title}
                            onChange={(e) => setField("title", e.target.value)}
                          />
                        </FormField>
                        <FormField label={t("library:cd.editor.albumArtist")}>
                          <TextInput
                            value={form.artist}
                            onChange={(e) => setField("artist", e.target.value)}
                          />
                        </FormField>
                        <FormField label={t("library:cd.editor.year")}>
                          <TextInput
                            type="number"
                            value={form.year}
                            onChange={(e) => setField("year", e.target.value)}
                          />
                        </FormField>
                        <FormField label={t("library:cd.editor.genre")}>
                          <TextInput
                            value={form.genre}
                            onChange={(e) => setField("genre", e.target.value)}
                          />
                        </FormField>
                      </div>
                    </div>
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

            <ModalFooter
              fade
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
        </>
      ) : null}
    </Modal>
  );
}
