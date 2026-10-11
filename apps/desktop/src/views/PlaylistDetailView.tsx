import { useCallback, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { applyTrackRating } from "../lib/applyTrackRating";
import { albumTotalDurationSeconds } from "../lib/albums";
import { formatTime } from "../lib/format";
import { getPlaylistById, resolvePlaylistTracks } from "../lib/playlists";
import { PlaylistArt } from "../components/PlaylistArt/PlaylistArt";
import { Button } from "../components/common/Button/Button";
import {
  ContextMenuItem,
  ContextMenuSeparator,
} from "../components/ContextMenu/ContextMenu";
import { MenuButton } from "../components/MenuButton/MenuButton";
import { TrackList } from "../components/TrackList/TrackList";
import {
  IconAddToQueue,
  IconDelete,
  IconPencil,
  IconPlay,
} from "../components/icons";
import { useDeletePlaylistDialog } from "../hooks/useDeletePlaylistDialog";
import { usePlayerStore } from "../store/usePlayerStore";
import { usePlaylistStore } from "../store/usePlaylistStore";
import type { Playlist } from "../types/playlist";
import type { CanonicalRating } from "../lib/trackRating";
import type { Track } from "../types/track";
import "./PlaylistDetailView.css";
import "./DetailViewShared.css";

interface PlaylistDetailViewProps {
  playlistId: number;
}

export function PlaylistDetailView({ playlistId }: PlaylistDetailViewProps) {
  const { t } = useTranslation("library");
  const playlists = usePlaylistStore((s) => s.playlists);
  const touchPlaylist = usePlaylistStore((s) => s.touchPlaylist);
  const playlist = getPlaylistById(playlists, playlistId);

  useEffect(() => {
    void touchPlaylist(playlistId);
  }, [playlistId, touchPlaylist]);

  if (!playlist) {
    return (
      <div className="playlist-detail playlist-detail--missing">
        <p>{t("views.playlists.notFound")}</p>
      </div>
    );
  }

  return <PlaylistDetailContent playlist={playlist} />;
}

function PlaylistDetailContent({ playlist }: { playlist: Playlist }) {
  const { t } = useTranslation("library");
  const openPlaylistEditor = usePlaylistStore((s) => s.openPlaylistEditor);
  const library = usePlayerStore((s) => s.library);
  const playTracks = usePlayerStore((s) => s.playTracks);
  const currentTrackId = usePlayerStore((s) => s.currentTrackId);
  const playbackState = usePlayerStore((s) => s.playbackState);
  const selectedTrackIds = usePlayerStore((s) => s.selectedTrackIds);
  const selectTracksInList = usePlayerStore((s) => s.selectTracksInList);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const updateTrackInLibrary = usePlayerStore((s) => s.updateTrackInLibrary);
  const reorderPlaylistTracks = usePlaylistStore(
    (s) => s.reorderPlaylistTracks,
  );
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
                <p className="playlist-detail__description">
                  {playlist.description}
                </p>
              ) : null}
              <p className="playlist-detail__stats">
                {[
                  t("counts.tracks", { count: tracks.length }),
                  formatTime(totalDuration),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <div className="detail-view__actions">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => openPlaylistEditor(playlist.id)}
                >
                  <IconPencil />
                  {t("actions.editPlaylist")}
                </Button>
                <MenuButton
                  triggerPlacement="below-start"
                  ariaLabel={t("views.playlists.actionsAria")}
                  layoutDeps={[tracks.length]}
                  size="sm"
                  variant="secondary"
                >
                  {(close) => (
                    <>
                      {tracks.length > 0 ? (
                        <ContextMenuItem
                          icon={<IconAddToQueue />}
                          label={t("actions.addToQueue")}
                          onClick={() => {
                            close();
                            handleAddToQueue();
                          }}
                        />
                      ) : null}
                      <ContextMenuItem
                        icon={<IconPlay />}
                        label={t("actions.playAll")}
                        disabled={tracks.length === 0}
                        onClick={() => {
                          close();
                          handlePlayAll();
                        }}
                      />
                      <ContextMenuSeparator />
                      <ContextMenuItem
                        icon={<IconDelete />}
                        label={t("actions.deletePlaylist")}
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
            </div>
          </section>
        </div>

        <div className="detail-view__tracks">
          {tracks.length === 0 ? (
            <p className="detail-view__empty">{t("views.playlists.empty")}</p>
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
