import { useCallback, useEffect, useMemo, useState } from "react";
import { DetailArtistLink } from "../components/DetailArtistLink/DetailArtistLink";
import { EntityArt } from "../components/EntityArt/EntityArt";
import { Button } from "../components/common/Button/Button";
import { ContextMenuItem, ContextMenuSeparator } from "../components/ContextMenu/ContextMenu";
import { MenuButton } from "../components/MenuButton/MenuButton";
import { TrackList } from "../components/TrackList/TrackList";
import {
  IconAddToQueue,
  IconBack,
  IconEject,
  IconImport,
  IconPlay,
} from "../components/icons";
import { mergeRemoteMetadataIntoDisc } from "../lib/cdMetadata";
import { ensureCdHeroArtValid } from "../lib/cdArt";
import { startCdHeroArtFetch } from "../lib/cdMetadataFetch";
import {
  albumTotalDurationSecondsFromCd,
  cdDiscTitle,
  cdTrackListId,
  cdTrackNumberFromListId,
  cdTracksForList,
} from "../lib/cdTracks";
import { startCdImport } from "../lib/cdImport";
import { formatTime } from "../lib/format";
import { setCdDetailDrive } from "../lib/tauri";
import { detailReturnLabel } from "../lib/navigationReturn";
import {
  isAlbumInLibrary,
  linkableArtistKey,
} from "../lib/trackNavigation";
import {
  setAllTracksChecked,
  toggleTrackChecked,
} from "../lib/trackCheckSelection";
import { getCdDriveById, useCdStore } from "../store/useCdStore";
import { useCdImportBlockingPlayback } from "../hooks/useCdImportBlockingPlayback";
import { useCdImportStore, cdImportRowIndicators } from "../store/useCdImportStore";
import { useNavigationStore } from "../store/useNavigationStore";
import { usePlayerStore } from "../store/usePlayerStore";
import type { Album } from "../types/album";
import type { Artist } from "../types/artist";
import type { Track } from "../types/track";
import "./CdDetailView.css";
import "./DetailViewShared.css";

interface CdDetailViewProps {
  driveId: string;
  albums: Album[];
  artists: Artist[];
}

export function CdDetailView({ driveId, albums, artists }: CdDetailViewProps) {
  const closeCdDrive = useNavigationStore((s) => s.closeCdDrive);
  const cdReturnContext = useNavigationStore((s) => s.cdReturnContext);
  const artistBrowseMode = useNavigationStore((s) => s.artistBrowseMode);
  const drives = useCdStore((s) => s.drives);
  const discsByDriveId = useCdStore((s) => s.discsByDriveId);
  const metadataByDriveId = useCdStore((s) => s.metadataByDriveId);
  const heroArtByDriveId = useCdStore((s) => s.heroArtByDriveId);
  const loadingDriveIds = useCdStore((s) => s.loadingDriveIds);
  const cdtextLoadingDriveIds = useCdStore((s) => s.cdtextLoadingDriveIds);
  const ejectingDriveIds = useCdStore((s) => s.ejectingDriveIds);
  const loadDisc = useCdStore((s) => s.loadDisc);
  const ejectDrive = useCdStore((s) => s.ejectDrive);

  const playCdTracks = usePlayerStore((s) => s.playCdTracks);
  const addCdToQueue = usePlayerStore((s) => s.addCdToQueue);
  const selectedTrackIds = usePlayerStore((s) => s.selectedTrackIds);
  const selectTracksInList = usePlayerStore((s) => s.selectTracksInList);
  const storeCdDriveId = usePlayerStore((s) => s.cdDriveId);
  const storeCurrentTrackId = usePlayerStore((s) => s.currentTrackId);
  const playbackState = usePlayerStore((s) => s.playbackState);
  const cdImportBlockingPlayback = useCdImportBlockingPlayback(driveId);
  const cdImportProgress = useCdImportStore((s) =>
    s.progress?.driveId === driveId ? s.progress : null,
  );
  const cdImportCompletedDisplay = useCdImportStore(
    (s) => s.completedDisplayByDriveId[driveId],
  );
  const clearCdImportCompletedDisplay = useCdImportStore(
    (s) => s.clearCompletedDisplay,
  );

  useEffect(() => {
    return () => {
      clearCdImportCompletedDisplay(driveId);
    };
  }, [driveId, clearCdImportCompletedDisplay]);

  const {
    importingTrackIds: cdImportingTrackIds,
    activeTrackId: cdImportingActiveTrackId,
    completedTrackIds: cdImportCompletedTrackIds,
  } = useMemo(
    () =>
      cdImportRowIndicators(
        cdImportProgress,
        cdImportCompletedDisplay,
        cdTrackListId,
      ),
    [cdImportProgress, cdImportCompletedDisplay],
  );

  const [checkedTrackIds, setCheckedTrackIds] = useState<number[]>([]);

  const drive = getCdDriveById(drives, driveId);
  const rawDisc = discsByDriveId[driveId];
  const remoteMetadata = metadataByDriveId[driveId] ?? null;
  const disc = useMemo(() => {
    if (rawDisc == null) return rawDisc;
    if (remoteMetadata == null) return rawDisc;
    return mergeRemoteMetadataIntoDisc(rawDisc, remoteMetadata);
  }, [rawDisc, remoteMetadata]);
  const isLoading = loadingDriveIds.has(driveId) || disc === undefined;
  const isLoadingCdText = cdtextLoadingDriveIds.has(driveId);
  const heroArtPath = heroArtByDriveId[driveId] ?? null;
  const isEjecting = ejectingDriveIds.has(driveId);
  const showBack = cdReturnContext?.kind !== "sidebar";
  const backLabel = detailReturnLabel(cdReturnContext, artists);
  const isActiveCdPlayback = storeCdDriveId === driveId;
  const currentTrackId = isActiveCdPlayback ? storeCurrentTrackId : null;
  const activePlaybackState = isActiveCdPlayback ? playbackState : "stopped";

  const libraryAlbumKeys = useMemo(
    () => new Set(albums.map((album) => album.key)),
    [albums],
  );
  const libraryArtistKeys = useMemo(
    () => new Set(artists.map((artist) => artist.key)),
    [artists],
  );

  const canNavigateAlbum = useCallback(
    (track: Track) => isAlbumInLibrary(track, libraryAlbumKeys),
    [libraryAlbumKeys],
  );

  useEffect(() => {
    void loadDisc(driveId);
  }, [driveId, loadDisc]);

  useEffect(() => {
    void (async () => {
      const valid = await ensureCdHeroArtValid(driveId);
      if (!valid) {
        startCdHeroArtFetch(driveId);
      }
    })();
  }, [driveId]);

  useEffect(() => {
    void setCdDetailDrive(driveId);
    return () => {
      void setCdDetailDrive(null);
    };
  }, [driveId]);

  const tracks = useMemo(
    () => (disc ? cdTracksForList(disc) : []),
    [disc],
  );

  const heroArtistKey = useMemo(
    () => linkableArtistKey(tracks[0], libraryArtistKeys, artistBrowseMode),
    [tracks, libraryArtistKeys, artistBrowseMode],
  );

  const trackIds = useMemo(() => tracks.map((track) => track.id), [tracks]);
  const trackIdsKey = trackIds.join(",");

  useEffect(() => {
    setCheckedTrackIds(trackIds);
  }, [driveId, trackIdsKey, trackIds]);

  const handlePlayDisc = useCallback(() => {
    if (!disc || disc.tracks.length === 0) return;
    void playCdTracks(driveId, tracks, disc.tracks[0].number);
  }, [disc, driveId, playCdTracks, tracks]);

  const handleAddToQueue = useCallback(() => {
    if (tracks.length === 0) return;
    addCdToQueue(driveId, tracks);
  }, [addCdToQueue, driveId, tracks]);

  const handlePlayTrack = useCallback(
    (track: Track) => {
      void playCdTracks(driveId, tracks, cdTrackNumberFromListId(track.id));
    },
    [driveId, playCdTracks, tracks],
  );

  const handleSelectTrack = useCallback(
    (track: Track, e: React.MouseEvent) => {
      selectTracksInList(track.id, trackIds, {
        shiftKey: e.shiftKey,
        metaKey: e.metaKey || e.ctrlKey,
      });
    },
    [selectTracksInList, trackIds],
  );

  const handleToggleChecked = useCallback(
    (track: Track, checked: boolean) => {
      setCheckedTrackIds((current) =>
        toggleTrackChecked(track.id, trackIds, current, checked),
      );
    },
    [trackIds],
  );

  const handleToggleAllChecked = useCallback(
    (checked: boolean) => {
      setCheckedTrackIds(setAllTracksChecked(trackIds, checked));
    },
    [trackIds],
  );

  const handleStartImport = useCallback(() => {
    if (!disc || checkedTrackIds.length === 0) return;
    startCdImport({
      driveId,
      disc,
      year: remoteMetadata?.year ?? null,
      checkedTrackNumbers: checkedTrackIds.map(cdTrackNumberFromListId),
    });
  }, [checkedTrackIds, disc, driveId, remoteMetadata?.year]);

  if (!drive) {
    return null;
  }

  const title = disc ? cdDiscTitle(disc, drive.name) : drive.name;
  const artistLine =
    disc?.album?.trim() && disc.artist?.trim() ? disc.artist.trim() : null;
  const totalDuration = disc
    ? albumTotalDurationSecondsFromCd(disc.tracks)
    : 0;
  const hasTracks = disc != null && disc.tracks.length > 0;
  const checkedCount = checkedTrackIds.length;
  const allTracksChecked =
    disc != null && checkedCount > 0 && checkedCount === disc.tracks.length;
  const importLabel = allTracksChecked
    ? "Import to Library"
    : checkedCount === 1
      ? "Import 1 track"
      : `Import ${checkedCount} tracks`;

  return (
    <div className="cd-detail detail-view">
      <div className="detail-view__body">
        <div className="detail-view__chrome">
        <div
          className={[
            "cd-detail__toolbar",
            !showBack && "cd-detail__toolbar--no-back",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {showBack ? (
            <Button
              variant="ghost"
              size="sm"
              className="cd-detail__back"
              onClick={closeCdDrive}
            >
              <IconBack />
              {backLabel}
            </Button>
          ) : null}
          <MenuButton
            ariaLabel="Disc actions"
            className="cd-detail__toolbar-menu"
            layoutDeps={[tracks.length, isEjecting, checkedCount, cdImportBlockingPlayback]}
            size="md"
            variant="secondary"
          >
            {(close) => (
              <>
                {hasTracks ? (
                  <ContextMenuItem
                    icon={<IconImport />}
                    label={importLabel}
                    disabled={checkedCount === 0 || cdImportBlockingPlayback}
                    onClick={() => {
                      close();
                      handleStartImport();
                    }}
                  />
                ) : null}
                <ContextMenuSeparator />
                <ContextMenuItem
                  icon={<IconPlay />}
                  label="Play All"
                  disabled={!hasTracks || cdImportBlockingPlayback}
                  onClick={() => {
                    close();
                    handlePlayDisc();
                  }}
                />
                {hasTracks ? (
                  <ContextMenuItem
                    icon={<IconAddToQueue />}
                    label="Add to Queue"
                    disabled={cdImportBlockingPlayback}
                    onClick={() => {
                      close();
                      handleAddToQueue();
                    }}
                  />
                ) : null}
                <ContextMenuSeparator />
                <ContextMenuItem
                  icon={<IconEject />}
                  label={isEjecting ? "Ejecting…" : "Eject"}
                  disabled={isEjecting}
                  onClick={() => {
                    close();
                    void ejectDrive(driveId);
                  }}
                />
              </>
            )}
          </MenuButton>
        </div>

        <section className="cd-detail__hero">
          <EntityArt
            artPath={heroArtPath}
            alt={title}
            className="album-art--hero cd-detail__art"
          />
          <div className="cd-detail__meta">
            <h1 className="cd-detail__title">{title}</h1>
            {artistLine ? (
              <DetailArtistLink
                className="cd-detail__artist"
                name={artistLine}
                artistKey={heroArtistKey}
              />
            ) : null}
            {hasTracks ? (
              <p className="cd-detail__stats">
                {[
                  `${disc.tracks.length} ${disc.tracks.length === 1 ? "track" : "tracks"}`,
                  formatTime(totalDuration),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            ) : null}
            {hasTracks ? (
              <div className="cd-detail__actions">
                <Button
                  variant="secondary"
                  size="sm"
                  className="cd-detail__import-btn"
                  disabled={!hasTracks || cdImportBlockingPlayback}
                  onClick={handlePlayDisc}
                >
                  <IconPlay />
                  Play All
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  className="cd-detail__import-btn"
                  disabled={checkedCount === 0 || cdImportBlockingPlayback}
                  onClick={handleStartImport}
                >
                  <IconImport />
                  {importLabel}
                </Button>
              </div>
            ) : null}
          </div>
        </section>
        </div>

        <div className="detail-view__tracks">
          {isLoading ? (
            <p className="detail-view__status">Reading disc…</p>
          ) : disc == null ? (
            <p className="detail-view__status">
              No audio CD detected in this drive.
            </p>
          ) : disc.tracks.length === 0 ? (
            <p className="detail-view__status">
              Could not read tracks from this disc.
            </p>
          ) : (
            <>
              {isLoadingCdText ? (
                <p className="cd-detail__status cd-detail__status--secondary">
                  Reading track titles…
                </p>
              ) : null}
              <TrackList
                presetId="cd"
                fillHeight={false}
                tracks={tracks}
              selectedTrackIds={selectedTrackIds}
              currentTrackId={currentTrackId}
              playbackState={activePlaybackState}
              onSelectTrack={handleSelectTrack}
              onPlayTrack={handlePlayTrack}
              canNavigateAlbum={canNavigateAlbum}
              cdDriveId={driveId}
              checkMode
              checkedTrackIds={checkedTrackIds}
              onToggleChecked={handleToggleChecked}
              onToggleAllChecked={handleToggleAllChecked}
              cdImportingTrackIds={cdImportingTrackIds}
              cdImportingActiveTrackId={cdImportingActiveTrackId}
              cdImportCompletedTrackIds={cdImportCompletedTrackIds}
              readOnly
              emptyMessage="No tracks on this disc."
            />
          </>
        )}
        </div>
      </div>
    </div>
  );
}
