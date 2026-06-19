import { useMemo } from "react";
import { formatTime } from "../../../lib/format";
import { runSkinAction } from "../../../lib/skinActions";
import {
  buildSkinPlaylistSourceOptions,
  resolveSkinPlaylistTracks,
} from "../../../lib/skinPlaylist";
import { usePlayerStore } from "../../../store/usePlayerStore";
import { usePlaylistStore } from "../../../store/usePlaylistStore";
import { useSkinStore } from "../../../store/useSkinStore";
import type { CompactPlaylistPresentation } from "../../../types/skin";
import "./SkinPlaylistView.css";

export function SkinPlaylistView({ presentation }: { presentation: CompactPlaylistPresentation }) {
  const sourceId = useSkinStore((s) => s.playlistSourceId);
  const library = usePlayerStore((s) => s.library);
  const playbackTracks = usePlayerStore((s) => s.playbackTracks);
  const cdQueueContext = usePlayerStore((s) => s.cdQueueContext);
  const playContextIds = usePlayerStore((s) => s.playContextIds);
  const manualQueueIds = usePlayerStore((s) => s.manualQueueIds);
  const currentTrackId = usePlayerStore((s) => s.currentTrackId);
  const playbackState = usePlayerStore((s) => s.playbackState);
  const playlists = usePlaylistStore((s) => s.playlists);

  const sourceOptions = useMemo(
    () => buildSkinPlaylistSourceOptions(playlists),
    [playlists],
  );

  const tracks = useMemo(
    () =>
      resolveSkinPlaylistTracks(sourceId, {
        library,
        playbackTracks,
        cdQueueTracks: cdQueueContext?.tracks,
        playContextIds,
        manualQueueIds,
        currentTrackId,
        playlists,
      }),
    [
      sourceId,
      library,
      playbackTracks,
      cdQueueContext?.tracks,
      playContextIds,
      manualQueueIds,
      currentTrackId,
      playlists,
    ],
  );

  const showDropdown = presentation.showDropdown !== false;
  const showDuration = presentation.showDuration !== false;

  const className = [
    "skin-playlist-view",
    presentation.classPrefix,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={className}>
      {showDropdown ? (
        <select
          className="skin-playlist-view__source"
          value={sourceId}
          aria-label="Playlist source"
          onChange={(event) => {
            runSkinAction("playlist.setSource", { sourceId: event.target.value });
          }}
        >
          {sourceOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      ) : null}

      <div className="skin-playlist-view__list" role="listbox" aria-label="Tracks">
        {tracks.length === 0 ? (
          <p className="skin-playlist-view__empty">No tracks</p>
        ) : (
          tracks.map((track) => {
            const isPlaying =
              track.id === currentTrackId && playbackState === "playing";
            const isCurrent = track.id === currentTrackId;

            return (
              <button
                key={track.id}
                type="button"
                role="option"
                aria-selected={isCurrent}
                className={[
                  "skin-playlist-view__row",
                  isCurrent && "skin-playlist-view__row--current",
                  isPlaying && "skin-playlist-view__row--playing",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => {
                  runSkinAction("playlist.playTrack", { trackId: track.id });
                }}
              >
                <span className="skin-playlist-view__title">{track.title}</span>
                {showDuration && track.durationSeconds != null ? (
                  <span className="skin-playlist-view__duration">
                    {formatTime(track.durationSeconds)}
                  </span>
                ) : null}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
