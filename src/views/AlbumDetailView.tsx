import { albumTotalDurationSeconds, getAlbumByKey } from "../lib/albums";
import { formatTime } from "../lib/format";
import { AlbumArt } from "../components/AlbumArt/AlbumArt";
import { TrackRowMenu } from "../components/TrackRowMenu/TrackRowMenu";
import { IconBack, IconPlay } from "../components/icons";
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
  const selectedTrackIds = usePlayerStore((s) => s.selectedTrackIds);
  const selectTracksInList = usePlayerStore((s) => s.selectTracksInList);

  const album = getAlbumByKey(albums, albumKey);

  if (!album) {
    return (
      <div className="album-detail album-detail--missing">
        <button type="button" className="album-detail__back" onClick={closeAlbum}>
          <IconBack />
          Albums
        </button>
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
        <button type="button" className="album-detail__back" onClick={closeAlbum}>
          <IconBack />
          Albums
        </button>
        <button
          type="button"
          className="album-detail__play-all"
          onClick={handlePlayAll}
        >
          <IconPlay />
          Play All
        </button>
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

      <ol className="album-detail__tracks">
        {album.tracks.map((track) => (
          <li key={track.id}>
            <TrackRowMenu track={track} className="album-track-row-wrap">
              <div
                role="button"
                tabIndex={0}
                className={[
                  "album-track-row",
                  selectedTrackIds.includes(track.id) &&
                    "album-track-row--selected",
                  track.id === currentTrackId && "album-track-row--playing",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={(e) => handleSelectTrack(track, e)}
                onDoubleClick={() => handlePlayTrack(track)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handlePlayTrack(track);
                }}
              >
                <span className="album-track-row__num">
                  {track.trackNumber ?? "—"}
                </span>
                <span className="album-track-row__title">{track.title}</span>
                <span className="album-track-row__duration">
                  {track.durationSeconds != null
                    ? formatTime(track.durationSeconds)
                    : "—"}
                </span>
              </div>
            </TrackRowMenu>
          </li>
        ))}
      </ol>
    </div>
  );
}
