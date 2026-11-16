import { useMemo } from "react";
import { useThemeAccent } from "@/hooks/useThemeAccent";
import {
  coverGradientFromPalette,
  getDefaultPalette,
  type CoverGradient,
} from "@/lib/ui/palette";

/** A gradient from the active theme's palette, dark enough for white text. */
export function useThemeGradient(): CoverGradient {
  const accent = useThemeAccent();
  return useMemo(
    () => coverGradientFromPalette(getDefaultPalette(accent)),
    [accent],
  );
}
