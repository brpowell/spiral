import { useMemo, useRef, useState } from "react";
import { TrackList } from "../components/TrackList/TrackList";
import {
  compareTracks,
  matchesTrackSearch,
} from "../components/TrackList/trackListSort";
import type {
  TrackListSortDir,
  TrackListSortField,
} from "../components/TrackList/types";
import { IconClose, IconSearch } from "../components/icons";
import { usePlayerStore } from "../store/usePlayerStore";
import type { Track } from "../types/track";
import "./LibraryView.css";

interface LibraryViewProps {
  tracks: Track[];
}

export function LibraryView({ tracks }: LibraryViewProps) {
  const playTracks = usePlayerStore((s) => s.playTracks);
  const currentTrackId = usePlayerStore((s) => s.currentTrackId);
  const playbackState = usePlayerStore((s) => s.playbackState);
  const selectedTrackIds = usePlayerStore((s) => s.selectedTrackIds);
  const selectTracksInList = usePlayerStore((s) => s.selectTracksInList);

  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<TrackListSortField>("title");
  const [sortDir, setSortDir] = useState<TrackListSortDir>("asc");
  const searchInputRef = useRef<HTMLInputElement>(null);

  const clearSearch = (refocus = false) => {
    setSearch("");
    if (refocus) searchInputRef.current?.focus();
  };

  const sortedTracks = useMemo(() => {
    const filtered = tracks.filter((t) => matchesTrackSearch(t, search));
    return [...filtered].sort((a, b) => compareTracks(a, b, sortField, sortDir));
  }, [tracks, search, sortField, sortDir]);

  const sortedTrackIds = useMemo(
    () => sortedTracks.map((t) => t.id),
    [sortedTracks],
  );

  const handleSort = (field: TrackListSortField) => {
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

  return (
    <div className="library-view">
      <header className="library-view__header">
        <div className="library-view__search">
          <IconSearch />
          <input
            ref={searchInputRef}
            type="text"
            role="searchbox"
            placeholder="Search title, artist, or album…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "a") {
                e.currentTarget.select();
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                if (search) clearSearch();
                e.currentTarget.blur();
              }
            }}
            aria-label="Search library"
          />
          {search ? (
            <button
              type="button"
              className="library-view__search-clear"
              onClick={() => clearSearch(true)}
              aria-label="Clear search"
            >
              <IconClose />
            </button>
          ) : null}
        </div>
      </header>

      {tracks.length === 0 ? (
        <p className="library-view__empty">
          No tracks yet. Import some music to get started.
        </p>
      ) : (
        <TrackList
          presetId="library"
          tracks={sortedTracks}
          selectedTrackIds={selectedTrackIds}
          currentTrackId={currentTrackId}
          playbackState={playbackState}
          onSelectTrack={handleSelectRow}
          onPlayTrack={handlePlayRow}
          sortField={sortField}
          sortDir={sortDir}
          onSort={handleSort}
          emptyMessage="No tracks match your search."
        />
      )}
    </div>
  );
}
