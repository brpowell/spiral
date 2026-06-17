import { useCallback, useEffect, useMemo, useState } from "react";
import { toAssetUrl } from "../../lib/assetUrl";
import { buildPlaybackOrder } from "../../lib/activeTrackList";
import { findPlaybackTrack } from "../../lib/playbackTrack";
import { getManualNextId } from "../../lib/playbackQueue";
import {
  extractPaletteFromImageUrl,
  getDefaultPalette,
} from "../../lib/palette";
import { evaluateSkinBind, type SkinBindState } from "../../lib/skinBinds";
import { useSkinModeAlwaysOnTop } from "../../lib/skinModeAlwaysOnTop";
import {
  OBSIDIAN_DEFAULT_TOKENS,
  findThemeByName,
  resolveThemeTokens,
} from "../../lib/theme";
import { useAssetUrl } from "../../hooks/useAssetUrl";
import { usePlayerStore } from "../../store/usePlayerStore";
import { useThemeStore } from "../../store/useThemeStore";
import type { SkinBindPath } from "../../types/skin";
import { computeAudioEnergy } from "./rendererUtils";
import type { VisualizerContext, VisualizerSurface } from "./types";

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

export function useVisualizerPalette(): string[] {
  const currentTrackId = usePlayerStore((s) => s.currentTrackId);
  const library = usePlayerStore((s) => s.library);
  const playbackTracks = usePlayerStore((s) => s.playbackTracks);
  const currentTrack = useMemo(
    () =>
      findPlaybackTrack({ library, playbackTracks, currentTrackId }) ?? null,
    [library, playbackTracks, currentTrackId],
  );

  const [palette, setPalette] = useState<string[]>(getDefaultPalette);

  useEffect(() => {
    let cancelled = false;
    const artPath = currentTrack?.artPath;

    if (!artPath) {
      setPalette(getDefaultPalette());
      return;
    }

    void toAssetUrl(artPath).then((url) =>
      extractPaletteFromImageUrl(url).then((colors) => {
        if (!cancelled) {
          setPalette(colors);
        }
      }),
    );

    return () => {
      cancelled = true;
    };
  }, [currentTrack?.artPath, currentTrackId]);

  return palette;
}

function useSkinBindState(): SkinBindState {
  const alwaysOnTop = useSkinModeAlwaysOnTop();
  const library = usePlayerStore((s) => s.library);
  const playbackTracks = usePlayerStore((s) => s.playbackTracks);
  const currentTrackId = usePlayerStore((s) => s.currentTrackId);
  const playbackState = usePlayerStore((s) => s.playbackState);
  const positionSeconds = usePlayerStore((s) => s.positionSeconds);
  const repeatMode = usePlayerStore((s) => s.repeatMode);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const volume = usePlayerStore((s) => s.volume);
  const muted = usePlayerStore((s) => s.muted);
  const playContextIds = usePlayerStore((s) => s.playContextIds);
  const manualQueueIds = usePlayerStore((s) => s.manualQueueIds);
  const currentPlayable = usePlayerStore((s) => s.currentPlayable);

  const currentTrack = useMemo(
    () =>
      findPlaybackTrack({ library, playbackTracks, currentTrackId }) ?? null,
    [library, playbackTracks, currentTrackId],
  );

  const artUrl = useAssetUrl(currentTrack?.artPath);

  const activeQueue = useMemo(
    () =>
      buildPlaybackOrder(
        manualQueueIds,
        playContextIds,
        library,
        currentTrackId,
      ),
    [manualQueueIds, playContextIds, library, currentTrackId],
  );

  const canGoPrevious = currentTrackId !== null;
  const canGoNext =
    currentTrackId !== null &&
    activeQueue.length > 0 &&
    getManualNextId(activeQueue, currentTrackId, repeatMode) !== null;

  return useMemo(
    (): SkinBindState => ({
      currentTrack,
      artUrl,
      playbackState,
      positionSeconds,
      repeatMode,
      shuffle,
      volume,
      muted,
      canGoPrevious,
      canGoNext,
      activeQueueLength: activeQueue.length,
      currentTrackId,
      alwaysOnTop,
      currentPlayable,
    }),
    [
      currentTrack,
      artUrl,
      playbackState,
      positionSeconds,
      repeatMode,
      shuffle,
      volume,
      muted,
      canGoPrevious,
      canGoNext,
      activeQueue.length,
      currentTrackId,
      alwaysOnTop,
      currentPlayable,
    ],
  );
}

function useResolvedThemeTokens(): Record<string, string> {
  const themes = useThemeStore((s) => s.themes);
  const activeThemeId = useThemeStore((s) => s.activeThemeId);

  return useMemo(() => {
    const theme =
      findThemeByName(themes, activeThemeId) ??
      findThemeByName(themes, "Obsidian") ??
      themes[0];
    if (!theme) {
      return Object.fromEntries(
        Object.entries(OBSIDIAN_DEFAULT_TOKENS).filter(
          (entry): entry is [string, string] => entry[1] !== undefined,
        ),
      );
    }
    return Object.fromEntries(
      Object.entries(resolveThemeTokens(theme)).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    );
  }, [themes, activeThemeId]);
}

export function useVisualizerContextBuilder(surface: VisualizerSurface) {
  const palette = useVisualizerPalette();
  const themeTokens = useResolvedThemeTokens();
  const bindState = useSkinBindState();
  const reducedMotion = usePrefersReducedMotion();
  const playbackState = usePlayerStore((s) => s.playbackState);
  const volume = usePlayerStore((s) => s.volume);
  const muted = usePlayerStore((s) => s.muted);

  const bind = useCallback(
    (path: SkinBindPath) => evaluateSkinBind(path, bindState),
    [bindState],
  );

  return useCallback(
    (
      size: VisualizerContext["size"],
      bins: readonly number[],
    ): VisualizerContext => ({
      surface,
      size,
      audio: {
        bins,
        isPlaying: playbackState === "playing",
        playbackState,
        volume: muted ? 0 : volume,
        ...computeAudioEnergy(bins),
      },
      bind,
      colors: {
        palette,
        tokens: themeTokens,
      },
      flags: {
        reducedMotion,
      },
    }),
    [
      surface,
      playbackState,
      volume,
      muted,
      bind,
      palette,
      themeTokens,
      reducedMotion,
    ],
  );
}
