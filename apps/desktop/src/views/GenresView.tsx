import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { BrowseView } from "@/components/BrowseView/BrowseView";
import { BrowseViewHeader } from "@/components/BrowseView/BrowseViewHeader";
import { BrowseGridBody } from "@/components/BrowseView/BrowseGridBody";
import { LibraryEmptyState } from "@/components/LibraryEmptyState/LibraryEmptyState";
import { SearchField } from "@/components/SearchField/SearchField";
import { EntityArt } from "@/components/EntityArt/EntityArt";
import { useGenreLook } from "@/hooks/useGenreLook";
import { playlistDesignBackgroundStyle } from "@/lib/playlists/playlistCoverPresets";
import { SpiralIcon } from "@/lib/iconLibrary";
import { useGenreEditMenu } from "@/hooks/useGenreEditMenu";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import type { Genre } from "@/lib/genres/genres";
import { createFuzzyMatcher } from "@/lib/ui/fuzzySearch";
import { useNavigationStore } from "@/store/useNavigationStore";
import "./GenresView.css";

interface GenresViewProps {
  genres: Genre[];
}

const genreSearch = createFuzzyMatcher<Genre>((g) => [g.name]);

function GenreCard({ genre }: { genre: Genre }) {
  const { t } = useTranslation("library");
  const openGenre = useNavigationStore((s) => s.openGenre);
  const { onContextMenu, contextMenu } = useGenreEditMenu(genre);
  const look = useGenreLook(genre);
  return (
    <>
      <button
        type="button"
        className={`genre-card${look.end ? " genre-card--gradient" : ""}`}
        style={playlistDesignBackgroundStyle(look.start, look.end)}
        onClick={() => openGenre(genre.key, genre.name)}
        onContextMenu={onContextMenu}
      >
        {look.artPath ? (
          <span className="genre-card__art" aria-hidden>
            <EntityArt artPath={look.artPath} variant="grid" />
          </span>
        ) : (
          <span className="genre-card__icon" aria-hidden>
            <SpiralIcon id={look.icon} />
          </span>
        )}
        <span className="genre-card__name">{genre.name}</span>
        <span className="genre-card__meta">
          {t("counts.tracks", { count: genre.tracks.length })}
        </span>
      </button>
      {contextMenu}
    </>
  );
}

export function GenresView({ genres }: GenresViewProps) {
  const { t } = useTranslation("library");
  const [search, setSearch] = useState("");
  const deferredSearch = useDebouncedValue(search, 150);

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
              <li key={genre.key}>
                <GenreCard genre={genre} />
              </li>
            ))}
          </ul>
        )}
      </BrowseGridBody>
    </BrowseView>
  );
}
