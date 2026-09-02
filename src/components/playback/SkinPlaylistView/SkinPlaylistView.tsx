import { useEffect, useMemo, useState } from "react";
import { useEntityArtSrc } from "../../EntityArt/useEntityArtSrc";
import { formatTime } from "../../../lib/format";
import { runSkinAction } from "../../../lib/skinActions";
import { skinDragRegionNoneProps } from "../../../lib/skinDragRegion";
import {
  buildSkinPlaylistSourceOptions,
  resolveSkinPlaylistTracks,
} from "../../../lib/skinPlaylist";
import { usePlayerStore } from "../../../store/usePlayerStore";
import { usePlaylistStore } from "../../../store/usePlaylistStore";
import { useSkinStore } from "../../../store/useSkinStore";
import type { NodeStyle, PlaylistNode } from "../../../types/skin";
import {
  styleFromSkinNode,
  useResolvedNodeStyle,
} from "../../../lib/skinNodeStyle";
import "./SkinPlaylistView.css";

function SkinPlaylistRowArt({ artPath }: { artPath: string | null }) {
  const src = useEntityArtSrc(artPath, "row");

  return (
    <span className="skin-playlist-view__art" aria-hidden>
      {src ? (
        <img
          src={src}
          alt=""
          className="skin-playlist-view__art-img"
          loading="lazy"
          decoding="async"
        />
      ) : null}
    </span>
  );
}

function mergeNodeStyles(
  ...parts: Array<NodeStyle | undefined>
): NodeStyle | undefined {
  const merged: NodeStyle = {};
  let any = false;
  for (const part of parts) {
    if (!part) continue;
    Object.assign(merged, part);
    any = true;
  }
  return any ? merged : undefined;
}

export function SkinPlaylistView({ node }: { node: PlaylistNode }) {
  const sourceId = useSkinStore((s) => s.playlistSourceId);
  const filterQuery = useSkinStore((s) => s.playlistFilterQuery);
  const library = usePlayerStore((s) => s.library);
  const playbackTracks = usePlayerStore((s) => s.playbackTracks);
  const cdQueueContext = usePlayerStore((s) => s.cdQueueContext);
  const playContextIds = usePlayerStore((s) => s.playContextIds);
  const manualQueueIds = usePlayerStore((s) => s.manualQueueIds);
  const currentTrackId = usePlayerStore((s) => s.currentTrackId);
  const playbackState = usePlayerStore((s) => s.playbackState);
  const playlists = usePlaylistStore((s) => s.playlists);
  const setPlaylistSource = useSkinStore((s) => s.setPlaylistSource);
  const [sourceHovered, setSourceHovered] = useState(false);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const resolvedStyle = useResolvedNodeStyle(node.style, node.styleWhen);
  const listItems = node.items ?? "tracks";
  const isSourceList = listItems === "sources";

  useEffect(() => {
    if (!node.defaultSource) return;
    setPlaylistSource(node.defaultSource);
  }, [node.defaultSource, setPlaylistSource]);

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
        filterQuery,
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
      filterQuery,
    ],
  );

  const showDropdown = !isSourceList && node.showDropdown !== false;
  const showDuration = !isSourceList && node.showDuration !== false;
  const showArtwork = !isSourceList && node.showArtwork === true;
  const sourceStyle = styleFromSkinNode(
    sourceHovered
      ? mergeNodeStyles(node.sourceStyle, node.sourceHoverStyle)
      : node.sourceStyle,
  );

  return (
    <div
      className={[
        "skin-playlist-view",
        isSourceList && "skin-playlist-view--sources",
      ]
        .filter(Boolean)
        .join(" ")}
      data-node-id={node.id}
      data-playlist-items={listItems}
      style={styleFromSkinNode(resolvedStyle, {
        omitOpacity: node.bounds !== undefined,
      })}
      {...skinDragRegionNoneProps()}
    >
      {showDropdown ? (
        <div
          className="skin-playlist-view__source-wrap"
          onMouseEnter={() => setSourceHovered(true)}
          onMouseLeave={() => setSourceHovered(false)}
        >
          <select
            className="skin-playlist-view__source"
            value={sourceId}
            aria-label="Playlist source"
            style={sourceStyle}
            onChange={(event) => {
              runSkinAction("playlist.setSource", {
                sourceId: event.target.value,
              });
            }}
          >
            {sourceOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div
        className="skin-playlist-view__list"
        role="listbox"
        aria-label={isSourceList ? "Playlist sources" : "Tracks"}
      >
        {isSourceList ? (
          sourceOptions.map((option) => {
            const isCurrent = option.id === sourceId;
            const isHovered = hoveredKey === option.id;
            const rowStyle = mergeNodeStyles(
              isHovered ? node.rowHoverStyle : undefined,
              isCurrent ? node.currentRowStyle : undefined,
            );

            return (
              <button
                key={option.id}
                type="button"
                role="option"
                aria-selected={isCurrent}
                className={[
                  "skin-playlist-view__row",
                  isCurrent && "skin-playlist-view__row--current",
                ]
                  .filter(Boolean)
                  .join(" ")}
                style={styleFromSkinNode(rowStyle)}
                onMouseEnter={() => setHoveredKey(option.id)}
                onMouseLeave={() =>
                  setHoveredKey((key) => (key === option.id ? null : key))
                }
                onClick={() => {
                  runSkinAction("playlist.setSource", {
                    sourceId: option.id,
                  });
                }}
              >
                <span className="skin-playlist-view__title">
                  {option.label}
                </span>
              </button>
            );
          })
        ) : tracks.length === 0 ? (
          <p className="skin-playlist-view__empty">No tracks</p>
        ) : (
          tracks.map((track) => {
            const rowKey = String(track.id);
            const isPlaying =
              track.id === currentTrackId && playbackState === "playing";
            const isCurrent = track.id === currentTrackId;
            const isHovered = hoveredKey === rowKey;
            const rowStyle = mergeNodeStyles(
              isHovered ? node.rowHoverStyle : undefined,
              isCurrent ? node.currentRowStyle : undefined,
              isPlaying ? node.playingRowStyle : undefined,
            );

            return (
              <button
                key={track.id}
                type="button"
                role="option"
                aria-selected={isCurrent}
                className={[
                  "skin-playlist-view__row",
                  showArtwork && "skin-playlist-view__row--with-art",
                  isCurrent && "skin-playlist-view__row--current",
                  isPlaying && "skin-playlist-view__row--playing",
                ]
                  .filter(Boolean)
                  .join(" ")}
                style={styleFromSkinNode(rowStyle)}
                onMouseEnter={() => setHoveredKey(rowKey)}
                onMouseLeave={() =>
                  setHoveredKey((key) => (key === rowKey ? null : key))
                }
                onClick={() => {
                  runSkinAction("playlist.playTrack", {
                    trackId: track.id,
                  });
                }}
              >
                {showArtwork ? (
                  <SkinPlaylistRowArt artPath={track.artPath} />
                ) : null}
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
