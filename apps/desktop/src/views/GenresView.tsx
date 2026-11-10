import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { BrowseView } from "@/components/BrowseView/BrowseView";
import { BrowseViewHeader } from "@/components/BrowseView/BrowseViewHeader";
import { BrowseGridBody } from "@/components/BrowseView/BrowseGridBody";
import { LibraryEmptyState } from "@/components/LibraryEmptyState/LibraryEmptyState";
import { SearchField } from "@/components/SearchField/SearchField";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { groupTracksIntoGenres, type Genre } from "@/lib/genres/genres";
import { createFuzzyMatcher } from "@/lib/ui/fuzzySearch";
import type { Track } from "@/types/track";
import "./GenresView.css";

interface GenresViewProps {
  tracks: Track[];
}

const genreSearch = createFuzzyMatcher<Genre>((g) => [g.name]);

export function GenresView({ tracks }: GenresViewProps) {
  const { t } = useTranslation("library");
  const [search, setSearch] = useState("");
  const deferredSearch = useDebouncedValue(search, 150);

  const genres = useMemo(() => groupTracksIntoGenres(tracks), [tracks]);
  const filtered = useMemo(
    () => genreSearch.rank(genres, deferredSearch),
    [genres, deferredSearch],
  );

  if (genres.length === 0) {
    return (
      <BrowseView>
        <LibraryEmptyState />
      </BrowseView>
    );
  }

  return (
    <BrowseView>
      <BrowseViewHeader
        className="browse-view__header--single-row"
        title={t("views.genres.title")}
        count={t("views.headerCount", { count: genres.length })}
        actions={
          <SearchField
            className="genres-view__search"
            value={search}
            onChange={setSearch}
            placeholder={t("views.genres.searchPlaceholder")}
            aria-label={t("views.genres.searchAria")}
          />
        }
      />
      <BrowseGridBody>
        {filtered.length === 0 ? (
          <p className="browse-view__empty">{t("views.genres.emptySearch")}</p>
        ) : (
          <ul className="genres-view__grid">
            {filtered.map((genre) => (
              <li key={genre.key} className="genre-card">
                <span className="genre-card__name">{genre.name}</span>
                <span className="genre-card__meta">
                  {t("counts.tracks", { count: genre.tracks.length })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </BrowseGridBody>
    </BrowseView>
  );
}
