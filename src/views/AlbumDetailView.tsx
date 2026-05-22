import { albumTotalDurationSeconds, getAlbumByKey } from "../lib/albums";
import { formatTime } from "../lib/format";
import { AlbumArt } from "../components/AlbumArt/AlbumArt";
import { Button } from "../components/Button/Button";
import { TrackList } from "../components/TrackList/TrackList";
import {
  IconAddToQueue,
  IconBack,
  IconEditInfo,
  IconPlay,
} from "../components/icons";
import { useNavigationStore } from "../store/useNavigationStore";
import { usePlayerStore } from "../store/usePlayerStore";
import type { Album } from "../types/album";
import type { Track } from "../types/track";
import "./AlbumDetailView.css";

interface AlbumDetailViewProps {
  albums: Album[];
  albumKey: string;
}

export function AlbumDetailView({ albums, albumKey }: AlbumDetailViewProps) {
  const closeAlbum = useNavigationStore((s) => s.closeAlbum);
  const playTracks = usePlayerStore((s) => s.playTracks);
  const currentTrackId = usePlayerStore((s) => s.currentTrackId);
  const playbackState = usePlayerStore((s) => s.playbackState);
  const selectedTrackIds = usePlayerStore((s) => s.selectedTrackIds);
  const selectTracksInList = usePlayerStore((s) => s.selectTracksInList);
  const openAlbumEditor = usePlayerStore((s) => s.openAlbumEditor);
  const addToQueue = usePlayerStore((s) => s.addToQueue);

  const album = getAlbumByKey(albums, albumKey);

  if (!album) {
    return (
      <div className="album-detail album-detail--missing">
        <Button
          variant="ghost"
          size="sm"
          className="album-detail__back"
          onClick={closeAlbum}
        >
          <IconBack />
          Albums
        </Button>
        <p>Album not found.</p>
      </div>
    );
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

  return (
    <div className="album-detail">
      <div className="album-detail__toolbar">
        <Button
          variant="ghost"
          size="sm"
          className="album-detail__back"
          onClick={closeAlbum}
        >
          <IconBack />
          Albums
        </Button>
        <div className="album-detail__toolbar-actions">
          <Button
            variant="secondary"
            size="sm"
            className="album-detail__edit"
            onClick={() => openAlbumEditor(album.key)}
          >
            <IconEditInfo />
            Edit Album
          </Button>
          {album.tracks.length > 0 ? (
            <Button
              variant="secondary"
              size="sm"
              className="album-detail__queue-all"
              onClick={handleAddToQueue}
            >
              <IconAddToQueue />
              Add to Queue
            </Button>
          ) : null}
          <Button
            variant="primary"
            size="sm"
            className="album-detail__play-all"
            onClick={handlePlayAll}
            disabled={album.tracks.length === 0}
          >
            <IconPlay />
            Play All
          </Button>
        </div>
      </div>

      <section className="album-detail__hero">
        <AlbumArt
          artPath={album.artPath}
          alt={album.title}
          className="album-art--hero album-detail__art"
        />
        <div className="album-detail__meta">
          <h1 className="album-detail__title">{album.title}</h1>
          <p className="album-detail__artist">{album.artist}</p>
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

      <TrackList
        presetId="album"
        tracks={album.tracks}
        selectedTrackIds={selectedTrackIds}
        currentTrackId={currentTrackId}
        playbackState={playbackState}
        onSelectTrack={handleSelectTrack}
        onPlayTrack={handlePlayTrack}
        bordered={false}
        className="album-detail__tracks"
      />
    </div>
  );
}
