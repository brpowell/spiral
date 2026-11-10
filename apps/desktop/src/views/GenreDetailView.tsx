import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/common/Button/Button";
import { ContextMenuItem } from "@/components/ContextMenu/ContextMenu";
import { MenuButton } from "@/components/MenuButton/MenuButton";
import { TrackList } from "@/components/TrackList/TrackList";
import {
  compareTracks,
  nextSort,
  type SortState,
} from "@/components/TrackList/trackListSort";
import type { TrackListSortField } from "@/components/TrackList/types";
import { IconAddToQueue, IconBack, IconPlay } from "@/components/icons";
import { albumTotalDurationSeconds } from "@/lib/albums/albums";
import { formatDurationNatural } from "@/lib/format/format";
import { getGenreByKey, type Genre } from "@/lib/genres/genres";
import { confirmAndApplyTrackRatings } from "@/lib/tracks/applyTrackRating";
import type { CanonicalRating } from "@/lib/tracks/trackRating";
import { useNavigationStore } from "@/store/useNavigationStore";
import { usePlayerStore } from "@/store/usePlayerStore";
import type { Track } from "@/types/track";
import "./GenreDetailView.css";
import "./DetailViewShared.css";

interface GenreDetailViewProps {
  genres: Genre[];
  genreKey: string;
}

export function GenreDetailView({ genres, genreKey }: GenreDetailViewProps) {
  const { t } = useTranslation("library");
  const closeGenre = useNavigationStore((s) => s.closeGenre);
  const playTracks = usePlayerStore((s) => s.playTracks);
  const currentTrackId = usePlayerStore((s) => s.currentTrackId);
  const playbackState = usePlayerStore((s) => s.playbackState);
  const selectedTrackIds = usePlayerStore((s) => s.selectedTrackIds);
  const selectTracksInList = usePlayerStore((s) => s.selectTracksInList);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const updateTrackInLibrary = usePlayerStore((s) => s.updateTrackInLibrary);
  const [sort, setSort] = useState<SortState>(null);

  const genre = getGenreByKey(genres, genreKey);

  // The genre vanishes when its last track is retagged; fall back to the list.
  useEffect(() => {
    if (!genre) closeGenre();
  }, [genre, closeGenre]);

  const tracks = useMemo(() => {
    const list = genre ? [...genre.tracks] : [];
    return sort
      ? list.sort((a, b) => compareTracks(a, b, sort.field, sort.dir))
      : list;
  }, [genre, sort]);
  const trackIds = useMemo(() => tracks.map((track) => track.id), [tracks]);

  const handleRatingChange = useCallback(
    (trackId: number, rating: CanonicalRating) => {
      const track = usePlayerStore
        .getState()
        .library.find((candidate) => candidate.id === trackId);
      if (!track) return;
      void confirmAndApplyTrackRatings([track], rating, updateTrackInLibrary);
    },
    [updateTrackInLibrary],
  );

  if (!genre) return null;

  const handlePlayAll = () => {
    const first = tracks[0];
    if (first) void playTracks(trackIds, first.id);
  };

  return (
    <div className="genre-detail detail-view">
      <div className="detail-view__body">
        <div className="detail-view__chrome">
          <div className="genre-detail__toolbar">
            <Button
              variant="ghost"
              size="sm"
              className="genre-detail__back"
              onClick={closeGenre}
            >
              <IconBack />
              {t("views.genres.title")}
            </Button>
          </div>

          <section className="genre-detail__hero">
            <h1 className="genre-detail__title">{genre.name}</h1>
            <p className="genre-detail__stats">
              {[
                t("counts.tracks", { count: tracks.length }),
                formatDurationNatural(albumTotalDurationSeconds(tracks)),
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
            <div className="detail-view__actions">
              <Button variant="secondary" size="sm" onClick={handlePlayAll}>
                <IconPlay />
                {t("actions.playAll")}
              </Button>
              <MenuButton
                ariaLabel={t("views.genres.actionsAria")}
                layoutDeps={[tracks.length]}
                size="sm"
                triggerPlacement="below-start"
                variant="secondary"
              >
                {(close) => (
                  <ContextMenuItem
                    icon={<IconAddToQueue />}
                    label={t("actions.addToQueue")}
                    onClick={() => {
                      close();
                      addToQueue(trackIds);
                    }}
                  />
                )}
              </MenuButton>
            </div>
          </section>
        </div>

        <div className="detail-view__tracks">
          <TrackList
            presetId="library"
            showAlbumArt
            fillHeight={false}
            tracks={tracks}
            selectedTrackIds={selectedTrackIds}
            currentTrackId={currentTrackId}
            playbackState={playbackState}
            onSelectTrack={(track: Track, e: React.MouseEvent) =>
              selectTracksInList(track.id, trackIds, {
                shiftKey: e.shiftKey,
                metaKey: e.metaKey || e.ctrlKey,
              })
            }
            onPlayTrack={(track: Track) => void playTracks(trackIds, track.id)}
            onRatingChange={handleRatingChange}
            sortField={sort?.field}
            sortDir={sort?.dir}
            onSort={(field: TrackListSortField) =>
              setSort((current) => nextSort(current, field))
            }
          />
        </div>
      </div>
    </div>
  );
}
