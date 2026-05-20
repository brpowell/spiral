import { useMemo, useState } from "react";
import { SearchField } from "../components/SearchField/SearchField";
import { TrackList } from "../components/TrackList/TrackList";
import {
  compareTracks,
  matchesTrackSearch,
} from "../components/TrackList/trackListSort";
import type {
  TrackListSortDir,
  TrackListSortField,
} from "../components/TrackList/types";
import { usePlayerStore } from "../store/usePlayerStore";
import type { Track } from "../types/track";
import "./TracksView.css";

interface TracksViewProps {
  tracks: Track[];
}

export function TracksView({ tracks }: TracksViewProps) {
  const playTracks = usePlayerStore((s) => s.playTracks);
  const currentTrackId = usePlayerStore((s) => s.currentTrackId);
  const playbackState = usePlayerStore((s) => s.playbackState);
  const selectedTrackIds = usePlayerStore((s) => s.selectedTrackIds);
  const selectTracksInList = usePlayerStore((s) => s.selectTracksInList);

  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<TrackListSortField>("title");
  const [sortDir, setSortDir] = useState<TrackListSortDir>("asc");

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
    <div className="tracks-view">
      <header className="tracks-view__header">
        <div className="tracks-view__heading">
          <h1 className="tracks-view__title">Tracks</h1>
          <span className="tracks-view__count">({tracks.length})</span>
        </div>
        <SearchField
          value={search}
          onChange={setSearch}
          placeholder="Search title, artist, or album…"
          aria-label="Search tracks"
        />
      </header>

      {tracks.length === 0 ? (
        <p className="tracks-view__empty">
          No tracks yet. Import some music to get started.
        </p>
      ) : (
        <TrackList
          presetId="library"
          showAlbumArt
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
