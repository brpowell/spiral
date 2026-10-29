import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { BrowseView } from "../components/BrowseView/BrowseView";
import { BrowseViewHeader } from "../components/BrowseView/BrowseViewHeader";
import { LibraryEmptyState } from "../components/LibraryEmptyState/LibraryEmptyState";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { SearchField } from "../components/SearchField/SearchField";
import { TrackList } from "../components/TrackList/TrackList";
import { TrackListSkeleton } from "../components/TrackList/TrackListSkeleton";
import {
  compareTracks,
  nextSort,
  scoreTracksBySearch,
  type SortState,
} from "../components/TrackList/trackListSort";
import type { TrackListSortField } from "../components/TrackList/types";
import { confirmAndApplyTrackRatings } from "../lib/applyTrackRating";
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
  const libraryLoaded = usePlayerStore((s) => s.libraryLoaded);

  const handleRatingChange = useCallback(
    (trackId: number, rating: CanonicalRating) => {
      const track = usePlayerStore
        .getState()
        .library.find((t) => t.id === trackId);
      if (!track) return;
      void confirmAndApplyTrackRatings([track], rating, updateTrackInLibrary);
    },
    [updateTrackInLibrary],
  );

  const [search, setSearch] = useState("");
  const deferredSearch = useDebouncedValue(search, 150);
  // Column sort, cycling asc -> desc -> unsorted. Unsorted is library order, or
  // relevance order while searching. The library sort persists; the search
  // sort lives only for the current search (cleared with the search box).
  const [librarySort, setLibrarySort] = useState<SortState>({
    field: "title",
    dir: "asc",
  });
  const [searchSort, setSearchSort] = useState<SortState>(null);
  const searching = deferredSearch.trim() !== "";
  const activeSort = searching ? searchSort : librarySort;

  const sortedTracks = useMemo(() => {
    const scored = scoreTracksBySearch(tracks, deferredSearch);
    if (searching && activeSort === null) {
      return scored
        .sort(
          (a, b) =>
            b.score - a.score || compareTracks(a.item, b.item, "title", "asc"),
        )
        .map((s) => s.item);
    }
    const matched = scored.map((s) => s.item);
    return activeSort
      ? matched.sort((a, b) =>
          compareTracks(a, b, activeSort.field, activeSort.dir),
        )
      : matched;
  }, [tracks, deferredSearch, searching, activeSort]);

  const sortedTrackIds = useMemo(
    () => sortedTracks.map((t) => t.id),
    [sortedTracks],
  );

  const playbackContextIds = useMemo(() => {
    const live = tracks.filter((t) => !isTrackImporting(t));
    if (librarySort) {
      live.sort((a, b) =>
        compareTracks(a, b, librarySort.field, librarySort.dir),
      );
    }
    return live.map((t) => t.id);
  }, [tracks, librarySort]);

  const handleSort = (field: TrackListSortField) => {
    const setSort = searching ? setSearchSort : setLibrarySort;
    setSort((current) => nextSort(current, field));
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

  if (tracks.length === 0 && !libraryLoaded) {
    return (
      <BrowseView className="tracks-view">
        <BrowseViewHeader
          title={t("views.tracks.title")}
          actions={
            <SearchField
              value=""
              onChange={() => {}}
              placeholder={t("views.tracks.searchPlaceholder")}
              aria-label={t("views.tracks.searchAria")}
            />
          }
        />
        <TrackListSkeleton />
      </BrowseView>
    );
  }

  if (tracks.length === 0) {
    return (
      <BrowseView>
        <LibraryEmptyState />
      </BrowseView>
    );
  }

  return (
    <BrowseView className="tracks-view">
      <BrowseViewHeader
        title={t("views.tracks.title")}
        count={
          importingCount > 0
            ? t("views.headerCountImporting", {
                live: liveCount,
                count: importingCount,
              })
            : t("views.headerCount", { count: liveCount })
        }
        actions={
          <SearchField
            value={search}
            onChange={(value) => {
              setSearch(value);
              if (value.trim() === "") setSearchSort(null);
            }}
            placeholder={t("views.tracks.searchPlaceholder")}
            aria-label={t("views.tracks.searchAria")}
          />
        }
      />

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
        sortField={activeSort?.field}
        sortDir={activeSort?.dir}
        onSort={handleSort}
        emptyMessage={t("views.tracks.emptySearch")}
      />
    </BrowseView>
  );
}
