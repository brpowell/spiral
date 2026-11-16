import { useMemo } from "react";
import { useArtPalette } from "@/hooks/useArtPalette";
import { usePopularity } from "@/hooks/usePopularity";
import { useThemeAccent } from "@/hooks/useThemeAccent";
import type { GenreDesign } from "@/lib/genres/genreDesign";
import {
  topAlbumForGenre,
  type GenreTopAlbum,
} from "@/lib/genres/genreTopAlbum";
import type { Genre } from "@/lib/genres/genres";
import { POPULARITY_COLUMN_PROFILE } from "@/lib/popularity/profiles";
import { coverGradientFromPalette, getDefaultPalette } from "@/lib/ui/palette";

/** What to draw for a genre, whichever art mode it is in. */
export interface GenreLook {
  start: string;
  end: string | null;
  /** The design icon, drawn when there is no album art. */
  icon: string;
  /** Album art to draw in the corner ("album" mode with an album that has art). */
  artPath: string | null;
  /** The album behind `artPath`, and why it was chosen. */
  top: GenreTopAlbum | null;
}

/**
 * The look for a genre with the given design. In "album" mode the gradient is
 * drawn from the most popular album's artwork; with no usable album it falls
 * back to shades of the active theme's accent.
 */
export function useGenreLook(genre: Genre, design: GenreDesign): GenreLook {
  const albumMode = design.mode === "album";
  const accent = useThemeAccent();
  const { scores } = usePopularity(POPULARITY_COLUMN_PROFILE, {
    enabled: albumMode,
  });

  const top = useMemo(
    () => (albumMode ? topAlbumForGenre(genre, scores) : null),
    [albumMode, genre, scores],
  );
  const artPath = top?.album.artPath ?? null;
  const artColors = useArtPalette(albumMode ? artPath : null, accent);

  const themeGradient = useMemo(
    () => coverGradientFromPalette(getDefaultPalette(accent)),
    [accent],
  );

  return useMemo(() => {
    if (!albumMode) {
      return {
        start: design.background,
        end: design.backgroundEnd,
        icon: design.icon,
        artPath: null,
        top: null,
      };
    }
    const gradient = artColors
      ? coverGradientFromPalette(artColors)
      : themeGradient;
    return {
      start: gradient.start,
      end: gradient.end,
      icon: design.icon,
      artPath,
      top,
    };
  }, [albumMode, design, artColors, themeGradient, artPath, top]);
}
