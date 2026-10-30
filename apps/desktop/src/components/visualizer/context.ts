import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toAssetUrl } from "../../lib/assetUrl";
import { findPlaybackTrack } from "../../lib/playbackTrack";
import {
  extractPaletteFromImageUrl,
  getDefaultPalette,
} from "../../lib/palette";
import { evaluateSkinBind, useSkinBindState } from "../../lib/skinBinds";
import {
  OBSIDIAN_DEFAULT_TOKENS,
  DEFAULT_THEME_ID,
  findThemeById,
  resolveThemeTokens,
} from "../../lib/theme";
import { usePlayerStore } from "../../store/usePlayerStore";
import { useThemeStore } from "../../store/useThemeStore";
import type { SkinBindPath } from "../../types/skin";
import { computeAudioEnergy } from "./rendererUtils";
import type { VisualizerContext } from "./types";
import { useVisualizerTrack } from "./vizTrackImages";

export function usePrefersReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReducedMotion(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  return reducedMotion;
}

/** The active theme's accent colour, or undefined before themes load. */
function useThemeAccent(): string | undefined {
  return useThemeStore((s) => {
    const theme =
      findThemeById(s.themes, s.activeThemeId) ??
      findThemeById(s.themes, DEFAULT_THEME_ID) ??
      s.themes[0];
    return theme ? resolveThemeTokens(theme)["color-accent"] : undefined;
  });
}

/**
 * Colours for visualizers: the current track's cover swatches, or (with no
 * cover) shades of the active theme's accent.
 */
export function useVisualizerPalette(): string[] {
  const currentTrackId = usePlayerStore((s) => s.currentTrackId);
  const library = usePlayerStore((s) => s.library);
  const playbackTracks = usePlayerStore((s) => s.playbackTracks);
  const accent = useThemeAccent();
  const currentTrack = useMemo(
    () =>
      findPlaybackTrack({ library, playbackTracks, currentTrackId }) ?? null,
    [library, playbackTracks, currentTrackId],
  );

  const [artPalette, setArtPalette] = useState<string[] | null>(null);
  // Read inside the extraction without re-extracting when the theme changes.
  const accentRef = useRef(accent);
  accentRef.current = accent;

  useEffect(() => {
    let cancelled = false;
    const artPath = currentTrack?.artPath;

    if (!artPath) {
      setArtPalette(null);
      return;
    }

    void toAssetUrl(artPath).then((url) =>
      extractPaletteFromImageUrl(url, accentRef.current).then((colors) => {
        if (!cancelled) {
          setArtPalette(colors);
        }
      }),
    );

    return () => {
      cancelled = true;
    };
  }, [currentTrack?.artPath, currentTrackId]);

  return useMemo(
    () => artPalette ?? getDefaultPalette(accent),
    [artPalette, accent],
  );
}

function definedTokens(
  tokens: Record<string, string | undefined>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(tokens).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
}

function useVisualizerTheme(): VisualizerContext["theme"] {
  const themes = useThemeStore((s) => s.themes);
  const activeThemeId = useThemeStore((s) => s.activeThemeId);

  return useMemo(() => {
    const theme =
      findThemeById(themes, activeThemeId) ??
      findThemeById(themes, DEFAULT_THEME_ID) ??
      themes[0];
    if (!theme) {
      return {
        name: "Obsidian",
        tokens: definedTokens(OBSIDIAN_DEFAULT_TOKENS),
      };
    }
    return {
      name: theme.name,
      tokens: definedTokens(resolveThemeTokens(theme)),
    };
  }, [themes, activeThemeId]);
}

export function useVisualizerContextBuilder() {
  const palette = useVisualizerPalette();
  const theme = useVisualizerTheme();
  const bindState = useSkinBindState();
  const reducedMotion = usePrefersReducedMotion();
  const playbackState = usePlayerStore((s) => s.playbackState);
  const volume = usePlayerStore((s) => s.volume);
  const muted = usePlayerStore((s) => s.muted);
  const track = useVisualizerTrack();

  const bind = useCallback(
    (path: SkinBindPath) => evaluateSkinBind(path, bindState),
    [bindState],
  );

  return useCallback(
    (
      size: VisualizerContext["size"],
      bins: readonly number[],
    ): VisualizerContext => ({
      scene: "default",
      size,
      audio: {
        bins,
        isPlaying: playbackState === "playing",
        playbackState,
        volume: muted ? 0 : volume,
        ...computeAudioEnergy(bins),
      },
      bind,
      theme,
      flags: {
        reducedMotion,
      },
      trackMetadata: {
        ...track,
        artColors: palette,
      },
    }),
    [playbackState, volume, muted, bind, palette, theme, reducedMotion, track],
  );
}
