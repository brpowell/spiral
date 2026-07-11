import { useCallback, useEffect, useMemo } from "react";
import { ContextMenuSeparator } from "../components/ContextMenu/ContextMenu";
import { applyTrackRating } from "../lib/applyTrackRating";
import { albumTotalDurationSeconds } from "../lib/albums";
import { formatTime } from "../lib/format";
import { detailReturnLabel } from "../lib/navigationReturn";
import { getPlaylistById, resolvePlaylistTracks } from "../lib/playlists";
import { PlaylistArt } from "../components/PlaylistArt/PlaylistArt";
import { Button } from "../components/common/Button/Button";
import { ContextMenuItem } from "../components/ContextMenu/ContextMenu";
import { MenuButton } from "../components/MenuButton/MenuButton";
import { TrackList } from "../components/TrackList/TrackList";
import {
  IconAddToQueue,
  IconBack,
  IconDelete,
  IconEditInfo,
  IconPlay,
} from "../components/icons";
import { useDeletePlaylistDialog } from "../hooks/useDeletePlaylistDialog";
import { useNavigationStore } from "../store/useNavigationStore";
import { usePlayerStore } from "../store/usePlayerStore";
import { usePlaylistStore } from "../store/usePlaylistStore";
import type { Artist } from "../types/artist";
import type { Playlist } from "../types/playlist";
import type { CanonicalRating } from "../lib/trackRating";
import type { Track } from "../types/track";
import "./PlaylistDetailView.css";
import "./DetailViewShared.css";

interface PlaylistDetailViewProps {
  playlistId: number;
  artists: Artist[];
}

export function PlaylistDetailView({
  playlistId,
  artists,
}: PlaylistDetailViewProps) {
  const closePlaylist = useNavigationStore((s) => s.closePlaylist);
  const playlistReturnContext = useNavigationStore(
    (s) => s.playlistReturnContext,
  );
  const playlists = usePlaylistStore((s) => s.playlists);
  const touchPlaylist = usePlaylistStore((s) => s.touchPlaylist);
  const playlist = getPlaylistById(playlists, playlistId);
  const backLabel = detailReturnLabel(playlistReturnContext, artists);

  useEffect(() => {
    void touchPlaylist(playlistId);
  }, [playlistId, touchPlaylist]);

  if (!playlist) {
    return (
      <div className="playlist-detail playlist-detail--missing">
        <Button
          variant="ghost"
          size="sm"
          className="playlist-detail__back"
          onClick={closePlaylist}
        >
          <IconBack />
          {backLabel}
        </Button>
        <p>Playlist not found.</p>
      </div>
    );
  }

  return (
    <PlaylistDetailContent playlist={playlist} backLabel={backLabel} />
  );
}

function PlaylistDetailContent({
  playlist,
  backLabel,
}: {
  playlist: Playlist;
  backLabel: string;
}) {
  const closePlaylist = useNavigationStore((s) => s.closePlaylist);
  const openPlaylistEditor = usePlaylistStore((s) => s.openPlaylistEditor);
  const library = usePlayerStore((s) => s.library);
  const playTracks = usePlayerStore((s) => s.playTracks);
  const currentTrackId = usePlayerStore((s) => s.currentTrackId);
  const playbackState = usePlayerStore((s) => s.playbackState);
  const selectedTrackIds = usePlayerStore((s) => s.selectedTrackIds);
  const selectTracksInList = usePlayerStore((s) => s.selectTracksInList);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const updateTrackInLibrary = usePlayerStore((s) => s.updateTrackInLibrary);
  const reorderPlaylistTracks = usePlaylistStore((s) => s.reorderPlaylistTracks);
  const { requestDelete, deleteDialog } = useDeletePlaylistDialog(playlist);

  const tracks = useMemo(
    () => resolvePlaylistTracks(playlist, library),
    [playlist, library],
  );

  const trackIds = tracks.map((t) => t.id);
  const totalDuration = albumTotalDurationSeconds(tracks);

  const handlePlayAll = () => {
    const first = tracks[0];
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

  return (
    <div className="playlist-detail detail-view">
      <div className="detail-view__body">
        <div className="detail-view__chrome">
        <div className="playlist-detail__toolbar">
          <Button
            variant="ghost"
            size="sm"
            className="playlist-detail__back"
            onClick={closePlaylist}
          >
            <IconBack />
            {backLabel}
          </Button>
          <MenuButton
            ariaLabel="Playlist actions"
            className="playlist-detail__toolbar-menu"
            layoutDeps={[tracks.length]}
            size="md"
            variant="secondary"
          >
            {(close) => (
              <>
                <ContextMenuItem
                  icon={<IconEditInfo />}
                  label="Edit Playlist"
                  onClick={() => {
                    close();
                    openPlaylistEditor(playlist.id);
                  }}
                />
                {tracks.length > 0 ? (
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
                  disabled={tracks.length === 0}
                  onClick={() => {
                    close();
                    handlePlayAll();
                  }}
                />
                <ContextMenuSeparator />
                <ContextMenuItem
                  icon={<IconDelete />}
                  label="Delete Playlist"
                  className="context-menu__danger"
                  onClick={() => {
                    close();
                    requestDelete();
                  }}
                />
              </>
            )}
          </MenuButton>
        </div>

        <section className="playlist-detail__hero">
          <PlaylistArt
            playlist={playlist}
            tracks={tracks}
            className="playlist-detail__art"
            alt={playlist.title}
          />
          <div className="playlist-detail__meta">
            <h1 className="playlist-detail__title">{playlist.title}</h1>
            {playlist.description ? (
              <p className="playlist-detail__description">{playlist.description}</p>
            ) : null}
            <p className="playlist-detail__stats">
              {[
                `${tracks.length} ${tracks.length === 1 ? "track" : "tracks"}`,
                formatTime(totalDuration),
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
        </section>
        </div>

        <div className="detail-view__tracks">
          {tracks.length === 0 ? (
            <p className="detail-view__empty">
              No tracks in this playlist. Add tracks from the library using the
              track context menu.
            </p>
          ) : (
            <TrackList
              presetId="playlist"
              playlistId={playlist.id}
              showAlbumArt
              fillHeight={false}
              tracks={tracks}
              selectedTrackIds={selectedTrackIds}
              currentTrackId={currentTrackId}
              playbackState={playbackState}
              onSelectTrack={handleSelectTrack}
              onPlayTrack={handlePlayTrack}
              onRatingChange={handleRatingChange}
              reorderable
              onReorderTracks={(trackIds) => {
                void reorderPlaylistTracks(playlist.id, trackIds);
              }}
            />
          )}
        </div>
      </div>
      {deleteDialog}
    </div>
  );
}
