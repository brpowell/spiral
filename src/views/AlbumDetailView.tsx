import { useCallback, useEffect, useMemo } from "react";
import {
  albumTotalDurationSeconds,
  getAlbumByKey,
  groupAlbumTracksByDisc,
} from "../lib/albums";
import { applyTrackRating } from "../lib/applyTrackRating";
import { detailReturnLabel } from "../lib/navigationReturn";
import { formatTime } from "../lib/format";
import { linkableArtistKey } from "../lib/trackNavigation";
import type { CanonicalRating } from "../lib/trackRating";
import { DetailArtistLink } from "../components/DetailArtistLink/DetailArtistLink";
import { EntityArt } from "../components/EntityArt/EntityArt";
import { Button } from "../components/common/Button/Button";
import { ContextMenuItem } from "../components/ContextMenu/ContextMenu";
import { MenuButton } from "../components/MenuButton/MenuButton";
import { TrackList } from "../components/TrackList/TrackList";
import {
  IconAddToQueue,
  IconBack,
  IconDisc,
  IconEditInfo,
  IconPlay,
} from "../components/icons";
import { useNavigationStore } from "../store/useNavigationStore";
import { usePlayerStore } from "../store/usePlayerStore";
import type { Album } from "../types/album";
import type { Artist } from "../types/artist";
import type { Track } from "../types/track";
import "./AlbumDetailView.css";
import "./DetailViewShared.css";

interface AlbumDetailViewProps {
  albums: Album[];
  artists: Artist[];
  albumKey: string;
}

export function AlbumDetailView({
  albums,
  artists,
  albumKey,
}: AlbumDetailViewProps) {
  const closeAlbum = useNavigationStore((s) => s.closeAlbum);
  const albumReturnContext = useNavigationStore((s) => s.albumReturnContext);
  const artistBrowseMode = useNavigationStore((s) => s.artistBrowseMode);
  const playTracks = usePlayerStore((s) => s.playTracks);
  const currentTrackId = usePlayerStore((s) => s.currentTrackId);
  const playbackState = usePlayerStore((s) => s.playbackState);
  const selectedTrackIds = usePlayerStore((s) => s.selectedTrackIds);
  const selectTracksInList = usePlayerStore((s) => s.selectTracksInList);
  const openAlbumEditor = usePlayerStore((s) => s.openAlbumEditor);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const updateTrackInLibrary = usePlayerStore((s) => s.updateTrackInLibrary);

  const album = getAlbumByKey(albums, albumKey);
  const backLabel = detailReturnLabel(albumReturnContext, artists);
  const libraryArtistKeys = useMemo(
    () => new Set(artists.map((artist) => artist.key)),
    [artists],
  );
  const albumArtistKey = useMemo(
    () =>
      linkableArtistKey(album?.tracks[0], libraryArtistKeys, artistBrowseMode),
    [album, libraryArtistKeys, artistBrowseMode],
  );
  const discGroups = useMemo(
    () => (album ? groupAlbumTracksByDisc(album.tracks) : []),
    [album],
  );
  const multipleDiscs = discGroups.length > 1;

  useEffect(() => {
    if (!album) {
      closeAlbum();
    }
  }, [album, closeAlbum]);

  if (!album) {
    return null;
  }

  const trackIds = album.tracks.map((t) => t.id);
  const totalDuration = albumTotalDurationSeconds(album.tracks);

  const handlePlayAll = () => {
    const first = album.tracks[0];
    if (first) void playTracks(trackIds, first.id);
  };

  const handleAddToQueue = () => {
    addToQueue(trackIds);
  };

  const handleSelectTrack = (track: Track, e: React.MouseEvent) => {
    selectTracksInList(track.id, trackIds, {
      shiftKey: e.shiftKey,
      metaKey: e.metaKey || e.ctrlKey,
    });
  };

  const handlePlayTrack = (track: Track) => {
    void playTracks(trackIds, track.id);
  };

  const handleRatingChange = useCallback(
    (trackId: number, rating: CanonicalRating) => {
      const track = usePlayerStore
        .getState()
        .library.find((t) => t.id === trackId);
      if (!track) return;
      applyTrackRating(track, rating, updateTrackInLibrary);
    },
    [updateTrackInLibrary],
  );

  const trackListProps = {
    presetId: "album" as const,
    selectedTrackIds,
    currentTrackId,
    playbackState,
    onSelectTrack: handleSelectTrack,
    onPlayTrack: handlePlayTrack,
    onRatingChange: handleRatingChange,
  };

  return (
    <div className="album-detail detail-view">
      <div className="detail-view__body">
        <div className="detail-view__chrome">
          <div className="album-detail__toolbar">
          <Button
            variant="ghost"
            size="sm"
            className="album-detail__back"
            onClick={closeAlbum}
          >
            <IconBack />
            {backLabel}
          </Button>
          <MenuButton
            ariaLabel="Album actions"
            className="album-detail__toolbar-menu"
            layoutDeps={[album.tracks.length]}
            size="md"
            variant="secondary"
          >
            {(close) => (
              <>
                <ContextMenuItem
                  icon={<IconEditInfo />}
                  label="Edit Album"
                  onClick={() => {
                    close();
                    openAlbumEditor(album.key);
                  }}
                />
                {album.tracks.length > 0 ? (
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
                  disabled={album.tracks.length === 0}
                  onClick={() => {
                    close();
                    handlePlayAll();
                  }}
                />
              </>
            )}
          </MenuButton>
          </div>

          <section className="album-detail__hero">
          <EntityArt
            artPath={album.artPath}
            alt={album.title}
            className="album-art--hero album-detail__art"
          />
          <div className="album-detail__meta">
            <h1 className="album-detail__title">{album.title}</h1>
            <DetailArtistLink
              className="album-detail__artist"
              name={album.artist}
              artistKey={albumArtistKey}
            />
            <p className="album-detail__stats">
              {[
                album.year != null ? String(album.year) : null,
                `${album.tracks.length} ${album.tracks.length === 1 ? "track" : "tracks"}`,
                formatTime(totalDuration),
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          </section>
        </div>

        <div className="detail-view__tracks">
          {multipleDiscs ? (
            <div className="album-detail__discs">
              {discGroups.map(({ discNumber, tracks: discTracks }) => (
                <section key={discNumber} className="album-detail__disc">
                  <h2 className="album-detail__disc-label">
                    <IconDisc aria-hidden />
                    Disc {discNumber}
                  </h2>
                  <TrackList
                    {...trackListProps}
                    fillHeight={false}
                    tracks={discTracks}
                  />
                </section>
              ))}
            </div>
          ) : (
            <TrackList
              {...trackListProps}
              fillHeight={false}
              tracks={album.tracks}
            />
          )}
        </div>
      </div>
    </div>
  );
}
