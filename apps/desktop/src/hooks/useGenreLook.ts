import { useMemo } from "react";
import { usePopularity } from "@/hooks/usePopularity";
import { useThemeGradient } from "@/hooks/useThemeGradient";
import { isThemeSolid } from "@/lib/genres/genreBackground";
import { defaultIconForGenre } from "@/lib/genres/genreIcon";
import { topAlbumForGenre } from "@/lib/genres/genreTopAlbum";
import type { Genre } from "@/lib/genres/genres";
import { POPULARITY_COLUMN_PROFILE } from "@/lib/popularity/profiles";
import { useGenreBackground } from "@/store/useGenreBackgroundStore";

/** What to draw for a genre. */
export interface GenreLook {
  start: string;
  /** Null for a solid color. */
  end: string | null;
  /** Drawn when there is no album art. */
  icon: string;
  /** The most popular album's artwork, drawn in the corner. */
  artPath: string | null;
}

/**
 * The look for a genre. The background is the color the user chose for it, or
 * else the theme palette (a gradient unless the user turned that off). It never comes from the artwork: it
 * must not change when the most popular album does. The cover of that album is
 * drawn in the corner, or an icon when the genre has no artwork.
 */
export function useGenreLook(genre: Genre): GenreLook {
  const { scores } = usePopularity(POPULARITY_COLUMN_PROFILE);
  const themeGradient = useThemeGradient();
  const chosen = useGenreBackground(genre.key);

  const top = useMemo(() => topAlbumForGenre(genre, scores), [genre, scores]);
  const artPath = top?.artPath ?? null;
  const icon = useMemo(() => defaultIconForGenre(genre.key), [genre.key]);

  return useMemo(
    () =>
      chosen && !isThemeSolid(chosen)
        ? { start: chosen.start, end: chosen.end, icon, artPath }
        : {
            start: themeGradient.start,
            end: isThemeSolid(chosen) ? null : themeGradient.end,
            icon,
            artPath,
          },
    [chosen, themeGradient, icon, artPath],
  );
}
