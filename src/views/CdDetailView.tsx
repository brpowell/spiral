import { useCallback, useEffect, useMemo } from "react";
import { Button } from "../components/common/Button/Button";
import { ContextMenuItem } from "../components/ContextMenu/ContextMenu";
import { MenuButton } from "../components/MenuButton/MenuButton";
import { TrackList } from "../components/TrackList/TrackList";
import {
  IconAddToQueue,
  IconBack,
  IconDisc,
  IconEject,
  IconPlay,
} from "../components/icons";
import {
  albumTotalDurationSecondsFromCd,
  cdDiscTitle,
  cdTrackNumberFromListId,
  cdTracksForList,
} from "../lib/cdTracks";
import { formatTime } from "../lib/format";
import { setCdDetailDrive } from "../lib/tauri";
import { detailReturnLabel } from "../lib/navigationReturn";
import {
  isAlbumInLibrary,
  isArtistInLibrary,
} from "../lib/trackNavigation";
import { getCdDriveById, useCdStore } from "../store/useCdStore";
import { useNavigationStore } from "../store/useNavigationStore";
import { usePlayerStore } from "../store/usePlayerStore";
import type { Album } from "../types/album";
import type { Artist } from "../types/artist";
import type { Track } from "../types/track";
import "./CdDetailView.css";

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

  const drive = getCdDriveById(drives, driveId);
  const disc = discsByDriveId[driveId];
  const isLoading = loadingDriveIds.has(driveId) || disc === undefined;
  const isLoadingCdText = cdtextLoadingDriveIds.has(driveId);
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

  const canNavigateArtist = useCallback(
    (track: Track) =>
      isArtistInLibrary(track, libraryArtistKeys, artistBrowseMode),
    [libraryArtistKeys, artistBrowseMode],
  );

  useEffect(() => {
    void loadDisc(driveId);
  }, [driveId, loadDisc]);

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

  const trackIds = useMemo(() => tracks.map((track) => track.id), [tracks]);

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

  return (
    <div className="cd-detail">
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
          layoutDeps={[tracks.length, isEjecting]}
          size="md"
          variant="secondary"
        >
          {(close) => (
            <>
              {hasTracks ? (
                <ContextMenuItem
                  icon={<IconAddToQueue />}
                  label="Add to Queue"
                  onClick={() => {
                    close();
                    handleAddToQueue();
                  }}
                />
              ) : null}
              <ContextMenuItem
                icon={<IconPlay />}
                label="Play All"
                disabled={!hasTracks}
                onClick={() => {
                  close();
                  handlePlayDisc();
                }}
              />
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
        <div className="cd-detail__art" aria-hidden>
          <IconDisc />
        </div>
        <div className="cd-detail__meta">
          <h1 className="cd-detail__title">{title}</h1>
          {artistLine ? (
            <p className="cd-detail__artist">{artistLine}</p>
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
        </div>
      </section>

      {isLoading ? (
        <p className="cd-detail__status">Reading disc…</p>
      ) : disc == null ? (
        <p className="cd-detail__status">
          No audio CD detected in this drive.
        </p>
      ) : disc.tracks.length === 0 ? (
        <p className="cd-detail__status">
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
            tracks={tracks}
            selectedTrackIds={selectedTrackIds}
            currentTrackId={currentTrackId}
            playbackState={activePlaybackState}
            onSelectTrack={handleSelectTrack}
            onPlayTrack={handlePlayTrack}
            canNavigateAlbum={canNavigateAlbum}
            canNavigateArtist={canNavigateArtist}
            cdDriveId={driveId}
            readOnly
            bordered={false}
            className="cd-detail__tracks"
            emptyMessage="No tracks on this disc."
          />
        </>
      )}
    </div>
  );
}
