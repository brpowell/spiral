import { useMemo, useState } from "react";
import { formatTime } from "../lib/format";
import { PlayingIndicator } from "../components/PlayingIndicator/PlayingIndicator";
import { IconEditInfo, IconSearch } from "../components/icons";
import { useTrackEditMenu } from "../hooks/useTrackEditMenu";
import { usePlayerStore } from "../store/usePlayerStore";
import type { Track } from "../types/track";
import "../components/TrackRowMenu/TrackRowMenu.css";
import "./LibraryView.css";

function LibraryTableRow({
  track,
  index,
  isSelected,
  isNowPlaying,
  isActivelyPlaying,
  onSelect,
  onPlay,
}: {
  track: Track;
  index: number;
  isSelected: boolean;
  isNowPlaying: boolean;
  isActivelyPlaying: boolean;
  onSelect: (e: React.MouseEvent) => void;
  onPlay: () => void;
}) {
  const { onContextMenu, openEditor, contextMenu, removeDialog } =
    useTrackEditMenu(track);

  const rowClass = [
    "library-table__row",
    "track-row-menu",
    isSelected && "library-table__row--selected",
    isNowPlaying && "library-table__row--playing",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
    <tr
      className={rowClass}
      onClick={onSelect}
      onDoubleClick={onPlay}
      onContextMenu={onContextMenu}
    >
      <td className="library-table__num">{index + 1}</td>
      <td
        className={[
          "library-table__title-cell",
          isActivelyPlaying && "library-table__title-cell--with-indicator",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <PlayingIndicator active={isActivelyPlaying} />
        <span className="library-table__title-text">{track.title}</span>
      </td>
      <td>{track.artist ?? "—"}</td>
      <td>{track.album ?? "—"}</td>
      <td className="library-table__duration">
        {track.durationSeconds != null ? formatTime(track.durationSeconds) : "—"}
      </td>
      <td className="library-table__actions">
        <button
          type="button"
          className="track-row-menu__edit track-row-menu__edit--table"
          aria-label="Edit track info"
          onClick={(e) => {
            e.stopPropagation();
            openEditor();
          }}
        >
          <IconEditInfo />
        </button>
      </td>
    </tr>
    {contextMenu}
    {removeDialog}
    </>
  );
}

type SortField = "index" | "title" | "artist" | "album" | "duration";
type SortDir = "asc" | "desc";

interface LibraryViewProps {
  tracks: Track[];
}

function compareTracks(
  a: Track,
  b: Track,
  field: SortField,
  dir: SortDir,
): number {
  let cmp = 0;

  switch (field) {
    case "index":
      cmp = a.id - b.id;
      break;
    case "title":
      cmp = a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
      break;
    case "artist":
      cmp = (a.artist ?? "").localeCompare(b.artist ?? "", undefined, {
        sensitivity: "base",
      });
      break;
    case "album":
      cmp = (a.album ?? "").localeCompare(b.album ?? "", undefined, {
        sensitivity: "base",
      });
      break;
    case "duration":
      cmp = (a.durationSeconds ?? 0) - (b.durationSeconds ?? 0);
      break;
  }

  return dir === "asc" ? cmp : -cmp;
}

function matchesSearch(track: Track, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [track.title, track.artist, track.album]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
}

export function LibraryView({ tracks }: LibraryViewProps) {
  const playTracks = usePlayerStore((s) => s.playTracks);
  const currentTrackId = usePlayerStore((s) => s.currentTrackId);
  const playbackState = usePlayerStore((s) => s.playbackState);
  const selectedTrackIds = usePlayerStore((s) => s.selectedTrackIds);
  const selectTracksInList = usePlayerStore((s) => s.selectTracksInList);

  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<SortField>("title");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const sortedTracks = useMemo(() => {
    const filtered = tracks.filter((t) => matchesSearch(t, search));
    return [...filtered].sort((a, b) => compareTracks(a, b, sortField, sortDir));
  }, [tracks, search, sortField, sortDir]);

  const sortedTrackIds = useMemo(
    () => sortedTracks.map((t) => t.id),
    [sortedTracks],
  );

  const handleSort = (field: SortField) => {
    if (field === sortField) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const handleSelectRow = (track: Track, e: React.MouseEvent) => {
    selectTracksInList(track.id, sortedTrackIds, {
      shiftKey: e.shiftKey,
      metaKey: e.metaKey || e.ctrlKey,
    });
  };

  const handlePlayRow = (track: Track) => {
    void playTracks(sortedTrackIds, track.id);
  };

  const sortIndicator = (field: SortField) => {
    if (field !== sortField) return null;
    return sortDir === "asc" ? " ↑" : " ↓";
  };

  return (
    <div className="library-view">
      <header className="library-view__header">
        <h1 className="library-view__title">Library</h1>
        <div className="library-view__search">
          <IconSearch />
          <input
            type="search"
            placeholder="Search title, artist, or album…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search library"
          />
        </div>
      </header>

      {tracks.length === 0 ? (
        <p className="library-view__empty">
          No tracks yet. Import some music to get started.
        </p>
      ) : (
        <div className="library-table-wrap">
          <table className="library-table">
            <thead>
              <tr>
                <th>
                  <button type="button" onClick={() => handleSort("index")}>
                    #{sortIndicator("index")}
                  </button>
                </th>
                <th>
                  <button type="button" onClick={() => handleSort("title")}>
                    Title{sortIndicator("title")}
                  </button>
                </th>
                <th>
                  <button type="button" onClick={() => handleSort("artist")}>
                    Artist{sortIndicator("artist")}
                  </button>
                </th>
                <th>
                  <button type="button" onClick={() => handleSort("album")}>
                    Album{sortIndicator("album")}
                  </button>
                </th>
                <th>
                  <button type="button" onClick={() => handleSort("duration")}>
                    Duration{sortIndicator("duration")}
                  </button>
                </th>
                <th className="library-table__actions-header" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {sortedTracks.length === 0 ? (
                <tr>
                  <td colSpan={6} className="library-table__no-results">
                    No tracks match your search.
                  </td>
                </tr>
              ) : (
                sortedTracks.map((track, index) => (
                  <LibraryTableRow
                    key={track.id}
                    track={track}
                    index={index}
                    isSelected={selectedTrackIds.includes(track.id)}
                    isNowPlaying={track.id === currentTrackId}
                    isActivelyPlaying={
                      track.id === currentTrackId && playbackState === "playing"
                    }
                    onSelect={(e) => handleSelectRow(track, e)}
                    onPlay={() => handlePlayRow(track)}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
