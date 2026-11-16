import { useMemo } from "react";
import { useArtPalette } from "@/hooks/useArtPalette";
import { usePopularity } from "@/hooks/usePopularity";
import { useThemeAccent } from "@/hooks/useThemeAccent";
import { defaultIconForGenre } from "@/lib/genres/genreIcon";
import { topAlbumForGenre } from "@/lib/genres/genreTopAlbum";
import type { Genre } from "@/lib/genres/genres";
import { POPULARITY_COLUMN_PROFILE } from "@/lib/popularity/profiles";
import { coverGradientFromPalette, getDefaultPalette } from "@/lib/ui/palette";

/** What to draw for a genre. */
export interface GenreLook {
  start: string;
  end: string;
  /** Drawn when there is no album art. */
  icon: string;
  /** The most popular album's artwork, drawn in the corner. */
  artPath: string | null;
}

/**
 * The look for a genre, made from the user's library: the cover of its most
 * popular album in the corner, with the gradient drawn from that artwork. With
 * no album artwork it falls back to shades of the active theme's accent.
 */
export function useGenreLook(genre: Genre): GenreLook {
  const accent = useThemeAccent();
  const { scores } = usePopularity(POPULARITY_COLUMN_PROFILE);

  const top = useMemo(() => topAlbumForGenre(genre, scores), [genre, scores]);
  const artPath = top?.artPath ?? null;
  const artColors = useArtPalette(artPath, accent);

  const themeGradient = useMemo(
    () => coverGradientFromPalette(getDefaultPalette(accent)),
    [accent],
  );
  const icon = useMemo(() => defaultIconForGenre(genre.key), [genre.key]);

  return useMemo(() => {
    const gradient = artColors
      ? coverGradientFromPalette(artColors)
      : themeGradient;
    return { start: gradient.start, end: gradient.end, icon, artPath };
  }, [artColors, themeGradient, icon, artPath]);
}
