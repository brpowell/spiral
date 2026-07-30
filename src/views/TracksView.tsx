import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { BrowseView } from "../components/BrowseView/BrowseView";
import { BrowseViewHeader } from "../components/BrowseView/BrowseViewHeader";
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
import { applyTrackRating } from "../lib/applyTrackRating";
import { isTrackImporting } from "../lib/pendingImportTrack";
import type { CanonicalRating } from "../lib/trackRating";
import { usePlayerStore } from "../store/usePlayerStore";
import type { Track } from "../types/track";
import "./TracksView.css";

interface TracksViewProps {
  tracks: Track[];
}

export function TracksView({ tracks }: TracksViewProps) {
  const { t } = useTranslation("library");
  const playTracks = usePlayerStore((s) => s.playTracks);
  const currentTrackId = usePlayerStore((s) => s.currentTrackId);
  const playbackState = usePlayerStore((s) => s.playbackState);
  const selectedTrackIds = usePlayerStore((s) => s.selectedTrackIds);
  const selectTracksInList = usePlayerStore((s) => s.selectTracksInList);
  const updateTrackInLibrary = usePlayerStore((s) => s.updateTrackInLibrary);

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

  const playbackContextIds = useMemo(
    () =>
      [...tracks]
        .filter((t) => !isTrackImporting(t))
        .sort((a, b) => compareTracks(a, b, sortField, sortDir))
        .map((t) => t.id),
    [tracks, sortField, sortDir],
  );

  const handleSort = (field: TrackListSortField) => {
    if (field === sortField) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const importingCount = tracks.filter((t) => isTrackImporting(t)).length;
  const liveCount = tracks.length - importingCount;

  const handleSelectRow = useCallback(
    (track: Track, e: React.MouseEvent) => {
      if (isTrackImporting(track)) return;
      selectTracksInList(track.id, sortedTrackIds, {
        shiftKey: e.shiftKey,
        metaKey: e.metaKey || e.ctrlKey,
      });
    },
    [selectTracksInList, sortedTrackIds],
  );

  const handlePlayRow = useCallback(
    (track: Track) => {
      if (isTrackImporting(track)) return;
      void playTracks(playbackContextIds, track.id);
    },
    [playTracks, playbackContextIds],
  );

  return (
    <BrowseView className="tracks-view">
      <BrowseViewHeader
        title="Tracks"
        count={
          <>
            ({liveCount}
            {importingCount > 0 ? `, ${importingCount} importing` : ""})
          </>
        }
        actions={
          <SearchField
            value={search}
            onChange={setSearch}
            placeholder="Search title, artist, or album…"
            aria-label="Search tracks"
          />
        }
      />

      {tracks.length === 0 ? (
        <p className="browse-view__empty">{t("empty.tracks")}</p>
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
          onRatingChange={handleRatingChange}
          sortField={sortField}
          sortDir={sortDir}
          onSort={handleSort}
          emptyMessage="No tracks match your search."
        />
      )}
    </BrowseView>
  );
}
