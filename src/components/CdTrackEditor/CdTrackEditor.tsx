import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useArtFileDrop } from "../../hooks/useArtFileDrop";
import { useAssetUrl } from "../../hooks/useAssetUrl";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useEditorDiscardPrompt } from "../../hooks/useEditorDiscardPrompt";
import { useTrackMetadataForm } from "../../hooks/useTrackMetadataForm";
import { parseArtistField } from "../../lib/artistNames";
import { collectArtistNameSuggestions } from "../../lib/artistNameSuggestions";
import {
  collectAlbumSuggestions,
  collectGenreSuggestions,
} from "../../lib/trackFieldSuggestions";
import {
  cdArtCacheKey,
  discOverridePatchFromTrackForm,
} from "../../lib/cdOverrideFromForm";
import { mergeDiscDisplayLayers } from "../../lib/cdMetadata";
import { cdTrackNumberFromListId, cdTracksForList } from "../../lib/cdTracks";
import { t } from "../../lib/i18n";
import { fetchCoverArtCandidates } from "../../lib/albumArtFetch";
import {
  cacheArtFromFile,
  cacheArtFromUrl,
  pickImageFile,
  warmMusicBrainzEntity,
} from "../../lib/tauri";
import { deriveRecordingFromCachedRelease } from "../../lib/musicBrainzReleaseRecordings";
import { useCdStore } from "../../store/useCdStore";
import { usePlayerStore } from "../../store/usePlayerStore";
import type { CoverArtCandidate } from "../../types/coverArt";
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
import { EntityArt } from "../EntityArt/EntityArt";
import {
  TrackEditorDetailsTab,
  TrackEditorInlineArt,
} from "../TrackEditor/TrackEditorDetailsTab";
import { Tab, TabList, TabPanel, Tabs } from "../common/Tabs/Tabs";
import { MusicBrainzEditorTab } from "../MusicBrainzEditorTab/MusicBrainzEditorTab";
import { isTrackEditorFieldMixed } from "../../lib/trackMetadataForm";
import "../TrackEditor/TrackEditor.css";

type CdTrackEditorTab = "details" | "musicbrainz";

export function CdTrackEditor() {
  const editingCdTrackIds = useCdStore((s) => s.editingCdTrackIds);
  const editingCdDriveId = useCdStore((s) => s.editingCdDriveId);
  const closeCdTrackEditor = useCdStore((s) => s.closeCdTrackEditor);
  const openCdAlbumEditor = useCdStore((s) => s.openCdAlbumEditor);
  const saveDiscOverride = useCdStore((s) => s.saveDiscOverride);
  const discsByDriveId = useCdStore((s) => s.discsByDriveId);
  const metadataByDriveId = useCdStore((s) => s.metadataByDriveId);
  const overridesByDriveId = useCdStore((s) => s.overridesByDriveId);
  const heroArtByDriveId = useCdStore((s) => s.heroArtByDriveId);
  const library = usePlayerStore((s) => s.library);

  const disc = useMemo(() => {
    if (editingCdDriveId == null) return null;
    const raw = discsByDriveId[editingCdDriveId];
    if (raw == null) return null;
    return mergeDiscDisplayLayers(
      raw,
      metadataByDriveId[editingCdDriveId],
      overridesByDriveId[editingCdDriveId],
    );
  }, [editingCdDriveId, discsByDriveId, metadataByDriveId, overridesByDriveId]);

  const tracks = useMemo(() => {
    if (editingCdDriveId == null || editingCdTrackIds.length === 0) return [];
    if (disc == null) return [];
    const artPath =
      overridesByDriveId[editingCdDriveId]?.artPath?.trim() ||
      heroArtByDriveId[editingCdDriveId] ||
      null;
    const all = cdTracksForList(disc).map((track) => ({
      ...track,
      artPath,
    }));
    const idSet = new Set(editingCdTrackIds);
    return all.filter((track) => idSet.has(track.id));
  }, [
    editingCdDriveId,
    editingCdTrackIds,
    disc,
    overridesByDriveId,
    heroArtByDriveId,
  ]);

  const isBulk = tracks.length > 1;
  const referenceTrack = tracks[0] ?? null;
  const editingKey = `${editingCdDriveId ?? ""}:${editingCdTrackIds.join(",")}`;
  const discId =
    editingCdDriveId != null
      ? discsByDriveId[editingCdDriveId]?.discId?.trim() || null
      : null;

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
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<CdTrackEditorTab>("details");
  const [fetchingArt, setFetchingArt] = useState(false);
  const [coverCandidates, setCoverCandidates] = useState<CoverArtCandidate[]>(
    [],
  );
  const [fetchMessage, setFetchMessage] = useState<string | null>(null);
  const [artDragOver, setArtDragOver] = useState(false);
  const [derivedEmptyKind, setDerivedEmptyKind] = useState<
    "resolving" | "releaseCacheMiss" | "unmatched" | null
  >(null);

  const {
    form,
    setForm,
    originalForm,
    setOriginalForm,
    pendingArtPath,
    setPendingArtPath,
    artSourcePath,
    setArtSourcePath,
    selectedCoverUrl,
    setSelectedCoverUrl,
    artChanged,
    hasChanges,
    setField,
    setRating,
  } = useTrackMetadataForm(tracks, editingKey);

  useEffect(() => {
    setActiveTab("details");
  }, [editingKey]);

  // Derive recording from cached disc release when never stamped.
  useEffect(() => {
    if (!form || !referenceTrack || isBulk) {
      setDerivedEmptyKind(null);
      return;
    }
    if (form.recordingMbid.trim()) {
      setDerivedEmptyKind(null);
      return;
    }
    const releaseMbid = disc?.releaseMbid?.trim() || "";
    if (!releaseMbid) {
      setDerivedEmptyKind(null);
      return;
    }

    let cancelled = false;
    setDerivedEmptyKind("resolving");
    void deriveRecordingFromCachedRelease({
      releaseMbid,
      discNumberForm: form.discNumber,
      trackNumberForm: form.trackNumber,
      discNumber: 1,
      trackNumber: referenceTrack.trackNumber,
    }).then(async (result) => {
      if (cancelled) return;
      if (result.status === "cacheMiss" || result.status === "noRelease") {
        setDerivedEmptyKind("releaseCacheMiss");
        return;
      }
      if (result.status === "unmatched") {
        setDerivedEmptyKind("unmatched");
        return;
      }

      const matched = result.recordingMbid;
      setDerivedEmptyKind(null);
      setForm((prev) => (prev ? { ...prev, recordingMbid: matched } : prev));
      setOriginalForm((prev) =>
        prev ? { ...prev, recordingMbid: matched } : prev,
      );
      if (editingCdDriveId == null) return;
      const number = cdTrackNumberFromListId(referenceTrack.id);
      try {
        await saveDiscOverride(editingCdDriveId, {
          tracks: { [String(number)]: { recordingMbid: matched } },
        });
      } catch {
        // Form still shows the derived ID; Save can persist.
      }
    });

    return () => {
      cancelled = true;
    };
  }, [
    editingKey,
    isBulk,
    disc?.releaseMbid,
    form?.recordingMbid,
    referenceTrack?.id,
    referenceTrack?.trackNumber,
    editingCdDriveId,
    setForm,
    setOriginalForm,
    saveDiscOverride,
  ]);

  const isOpen =
    editingCdDriveId != null &&
    editingCdTrackIds.length > 0 &&
    tracks.length > 0 &&
    form != null;

  useEffect(() => {
    if (!isOpen || isBulk) return;
    warmMusicBrainzEntity("release", disc?.releaseMbid);
    warmMusicBrainzEntity(
      "recording",
      form?.recordingMbid || referenceTrack?.recordingMbid,
    );
  }, [
    isOpen,
    isBulk,
    editingKey,
    disc?.releaseMbid,
    form?.recordingMbid,
    referenceTrack?.recordingMbid,
  ]);

  useFocusTrap(dialogRef, isOpen);

  const {
    discardPrompt,
    setDiscardPrompt,
    requestClose,
    handleBackdropClick,
    dismissDiscardPrompt,
  } = useEditorDiscardPrompt(hasChanges, closeCdTrackEditor);

  const applyArtPath = useCallback(
    async (sourcePath: string) => {
      if (!discId) {
        setSaveError(t("library:cd.editor.missingDiscId"));
        return;
      }
      setSaveError(null);
      try {
        const cached = await cacheArtFromFile(
          sourcePath,
          cdArtCacheKey(discId),
        );
        setArtSourcePath(sourcePath);
        setSelectedCoverUrl(null);
        setPendingArtPath(cached);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setSaveError(message);
      }
    },
    [discId, setArtSourcePath, setPendingArtPath, setSelectedCoverUrl],
  );

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
      const candidates = await fetchCoverArtCandidates({
        artist: primaryArtist,
        album: form.album,
        releaseMbid: tracks[0]?.releaseMbid?.trim() || null,
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

  const handleSave = async () => {
    if (
      !form ||
      !originalForm ||
      !hasChanges ||
      editingCdDriveId == null ||
      tracks.length === 0
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
      const artPath = artChanged ? await resolveArtPath() : pendingArtPath;
      const patch = discOverridePatchFromTrackForm(
        tracks,
        form,
        artPath,
        artChanged,
      );
      await saveDiscOverride(editingCdDriveId, patch);
      setDiscardPrompt(false);
      closeCdTrackEditor();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSaveError(message);
    } finally {
      setSaving(false);
    }
  };

  const displayArtSrc = useAssetUrl(selectedCoverUrl ? null : pendingArtPath);
  const previewSrc = selectedCoverUrl ?? displayArtSrc;

  const identityTitle = form?.title.trim() || "Untitled";
  const identitySubtitle = [
    form ? parseArtistField(form.artist).join(", ") : "",
    form?.album.trim() ?? "",
  ]
    .filter(Boolean)
    .join(" · ");

  const discardDescription = isBulk
    ? t("library:cd.editor.discardBulk", { count: tracks.length })
    : t("library:cd.editor.discardSingle");

  return (
    <Modal
      open={isOpen}
      onClose={handleBackdropClick}
      size="editor"
      panelClassName="track-editor-modal"
      panelRef={dialogRef}
      labelledBy="cd-track-editor-title"
    >
      {isOpen && form ? (
        <>
          <div
            className="track-editor-modal__content track-editor-modal__content--tabbed"
            inert={discardPrompt || undefined}
          >
            <ModalHeader
              className={isBulk ? undefined : "track-editor__identity-header"}
            >
              {isBulk ? (
                <ModalHeaderMain>
                  <ModalTitle id="cd-track-editor-title">
                    {t("library:cd.editor.editTracks", {
                      count: tracks.length,
                    })}
                  </ModalTitle>
                  <ModalDescription>
                    {t("library:cd.editor.editTracksDescription", {
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
                      id="cd-track-editor-title"
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
              onChange={(tab) => setActiveTab(tab as CdTrackEditorTab)}
              className="track-editor__tabs"
              variant="underline"
            >
              <div className="track-editor__tab-bar">
                <TabList aria-label={t("library:editor.cdTrackTabsAria")}>
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
                      <TrackEditorInlineArt
                        previewSrc={previewSrc}
                        artDragOver={artDragOver}
                        fetchingArt={fetchingArt}
                        fetchMessage={fetchMessage}
                        coverCandidates={coverCandidates}
                        selectedCoverUrl={selectedCoverUrl}
                        onArtDragOver={setArtDragOver}
                        onArtDrop={(e) => void handleArtDrop(e)}
                        onChangeArt={() => void handleChangeArt()}
                        onFetchArt={() => void handleFetchArt()}
                        onSelectCover={handleSelectCover}
                      />
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
                    </div>
                  </TabPanel>

                  <TabPanel
                    value="musicbrainz"
                    className="track-editor__tab-panel"
                    keepMounted
                  >
                    <MusicBrainzEditorTab
                      kind="recording"
                      assignment="derived"
                      mbid={form.recordingMbid}
                      mixed={isTrackEditorFieldMixed(tracks, "recordingMbid")}
                      hasAlbum={Boolean(form.album.trim())}
                      albumTitle={form.album.trim()}
                      hasAlbumRelease={Boolean(disc?.releaseMbid?.trim())}
                      derivedEmptyKind={derivedEmptyKind ?? undefined}
                      onSearchAlbumRelease={() => {
                        if (editingCdDriveId == null || !form.album.trim())
                          return;
                        openCdAlbumEditor(editingCdDriveId, {
                          tab: "musicbrainz",
                          autoOpenMbSearch:
                            derivedEmptyKind !== "releaseCacheMiss",
                        });
                      }}
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
            description={discardDescription}
            onKeepEditing={dismissDiscardPrompt}
            onDiscard={closeCdTrackEditor}
          />
        </>
      ) : null}
    </Modal>
  );
}
