import { useMemo } from "react";
import { presetLabel } from "./equalizer/builtinPresets";
import { formatTime, formatRemainingTime } from "./format";
import { buildPlaybackOrder } from "./playbackOrder";
import { findPlaybackTrack } from "./playbackTrack";
import { getManualNextId } from "./playbackQueue";
import { getNextSkippingKnownUnplayable } from "./playbackSkip";
import { formatMetadataLine, playbackStatus } from "./skinMetadataLine";
import { useSkinModeAlwaysOnTop } from "./skinModeAlwaysOnTop";
import { evaluateSlideshowBind } from "./skinSlideshow";
import { evaluateScrollStripBind } from "./skinScrollStrip";
import { evaluateViewBind, useSkinViewState } from "./skinViewStateContext";
import { useSkinSlideshowState } from "./skinSlideshowContext";
import { useSkinScrollStripState } from "./skinScrollStripContext";
import {
  labelForSkinPlaylistSource,
  resolveSkinPlaylistTrackCount,
} from "./skinPlaylist";
import { activeVisualizerName, canCycleVisualizers } from "./visualizerCycle";
import { useAssetUrl } from "../hooks/useAssetUrl";
import { usePlayerStore } from "../store/usePlayerStore";
import { usePlaylistStore } from "../store/usePlaylistStore";
import { useSkinStore } from "../store/useSkinStore";
import { useVisualizerStore } from "../store/useVisualizerStore";
import { useEqualizerStore } from "../store/useEqualizerStore";
import { usePlaybackSettingsStore } from "../store/usePlaybackSettingsStore";
import { useSkinPreferencesStore } from "../store/useSkinPreferencesStore";
import { soundEffectsEnabledFromPreferences } from "../types/skinPreferences";
import type { EqualizerBandGains, EqualizerPreset } from "./equalizer/types";
import type { PlayableRef } from "../types/playable";
import type {
  ScrollStripPresentation,
  SkinBindPath,
  SkinCondition,
  SlideshowPresentation,
} from "../types/skin";
import type { Track } from "../types/track";
import type { Playlist } from "../types/playlist";
import type { ScrollStripStateMap } from "./skinScrollStrip";
import type { SlideshowStateMap } from "./skinSlideshow";
import type { ViewStateValues } from "./skinViewStateContext";

export type SkinBindValue = string | number | boolean | null;

export interface SkinBindState {
  currentTrack: ReturnType<typeof findPlaybackTrack> | null;
  artUrl: string | null;
  playbackState: ReturnType<typeof usePlayerStore.getState>["playbackState"];
  positionSeconds: number;
  repeatMode: ReturnType<typeof usePlayerStore.getState>["repeatMode"];
  shuffle: boolean;
  volume: number;
  balance: number;
  muted: boolean;
  canGoPrevious: boolean;
  canGoNext: boolean;
  activeQueueLength: number;
  currentTrackId: number | null;
  alwaysOnTop: boolean;
  currentPlayable: PlayableRef | null;
  /** View ids with open auxiliary windows for the active skin. */
  openAuxiliaryViews: string[];
  visualizerName: string;
  canCycleVisualizer: boolean;
  playlistSourceId: string;
  playlists: Playlist[];
  library: Track[];
  playbackTracks: Track[];
  cdQueueTracks?: Track[];
  playContextIds: number[];
  manualQueueIds: number[];
  eqEnabled: boolean;
  eqPresetId: string;
  eqBands: EqualizerBandGains;
  eqCustomPresets: EqualizerPreset[];
  soundEffectsEnabled: boolean;
  crossfadeEnabled: boolean;
  viewState: ViewStateValues;
  slideshowPresentations: Record<string, SlideshowPresentation>;
  slideshowState: SlideshowStateMap;
  scrollStripPresentations: Record<string, ScrollStripPresentation>;
  scrollStripState: ScrollStripStateMap;
}

const AUX_VIEW_BIND_RE = /^skin\.view\.([^.]+)\.(open|closed)$/;

function evaluateAuxViewBind(
  path: string,
  openAuxiliaryViews: string[],
): boolean | null {
  const match = path.match(AUX_VIEW_BIND_RE);
  if (!match) return null;
  const [, viewId, prop] = match;
  const isOpen = openAuxiliaryViews.includes(viewId);
  return prop === "open" ? isOpen : !isOpen;
}

export function evaluateSkinBind(
  path: SkinBindPath | string,
  state: SkinBindState,
): SkinBindValue {
  const auxViewValue = evaluateAuxViewBind(path, state.openAuxiliaryViews);
  if (auxViewValue !== null) {
    return auxViewValue;
  }

  const viewValue = evaluateViewBind(path, state.viewState);
  if (viewValue !== null) {
    return viewValue;
  }

  const slideshowValue = evaluateSlideshowBind(
    path,
    state.slideshowPresentations,
    state.slideshowState,
  );
  if (slideshowValue !== null) {
    return slideshowValue;
  }

  const scrollStripValue = evaluateScrollStripBind(
    path,
    state.scrollStripPresentations,
    state.scrollStripState,
  );
  if (scrollStripValue !== null) {
    return scrollStripValue;
  }

  if (path.startsWith("skin.pref.")) {
    const key = path.slice("skin.pref.".length);
    if (key === "soundEffectsEnabled") {
      return state.soundEffectsEnabled;
    }
    return null;
  }

  const { currentTrack } = state;

  switch (path) {
    case "track.title":
      return currentTrack?.title ?? "";
    case "track.artist":
      return currentTrack?.artist ?? null;
    case "track.metadataLine":
      if (!currentTrack) return "";
      return formatMetadataLine(
        playbackStatus(state.playbackState),
        currentTrack.artist,
        currentTrack.title,
      );
    case "track.album":
      return currentTrack?.album ?? null;
    case "track.artUrl":
      return state.artUrl;
    case "track.durationSeconds":
      return currentTrack?.durationSeconds ?? null;
    case "player.isPlaying":
      return state.playbackState === "playing";
    case "player.notPlaying":
      return state.playbackState !== "playing";
    case "player.playbackState":
      return state.playbackState;
    case "player.positionSeconds":
      return state.positionSeconds;
    case "player.positionLabel":
      return formatTime(state.positionSeconds);
    case "player.durationLabel": {
      const duration = currentTrack?.durationSeconds;
      return duration != null ? formatTime(duration) : "0:00";
    }
    case "player.remainingLabel": {
      const duration = currentTrack?.durationSeconds ?? 0;
      return formatRemainingTime(state.positionSeconds, duration);
    }
    case "player.volumePercent":
      return Math.round(usePlayerStore.getState().volume * 100);
    case "player.repeatMode":
      return state.repeatMode;
    case "player.repeatOn":
      return state.repeatMode !== "off";
    case "player.shuffle":
      return state.shuffle;
    case "player.crossfadeEnabled":
      return state.crossfadeEnabled;
    case "player.volume":
      return usePlayerStore.getState().volume;
    case "player.balance":
      return usePlayerStore.getState().balance;
    case "player.muted":
      return state.muted;
    case "player.canGoPrevious":
      return state.canGoPrevious;
    case "player.canGoNext":
      return state.canGoNext;
    case "queue.length":
      return state.activeQueueLength;
    case "player.hasTrack":
      return state.currentTrackId !== null;
    case "skin.alwaysOnTop":
      return state.alwaysOnTop;
    case "playback.source":
      if (!state.currentPlayable) return null;
      return state.currentPlayable.type === "cd" ? "cd" : "file";
    case "visualizer.name":
      return state.visualizerName;
    case "visualizer.canGoPrevious":
    case "visualizer.canGoNext":
      return state.canCycleVisualizer;
    case "playlist.sourceLabel":
      return labelForSkinPlaylistSource(
        state.playlistSourceId,
        state.playlists,
      );
    case "playlist.trackCount":
      return playlistTrackCount(state);
    case "playlist.hasTracks":
      return playlistTrackCount(state) > 0;
    case "eq.enabled":
      return state.eqEnabled;
    case "eq.presetId":
      return state.eqPresetId;
    case "eq.isManual":
      return state.eqPresetId === "manual";
    case "eq.presetLabel":
      return presetLabel(state.eqPresetId, state.eqCustomPresets);
    default: {
      if (path.startsWith("eq.band.")) {
        const band = Number.parseInt(path.slice("eq.band.".length), 10);
        if (band >= 1 && band <= state.eqBands.length) {
          return state.eqBands[band - 1];
        }
      }
      return null;
    }
  }
}

export function evaluateSkinCondition(
  condition: SkinCondition,
  state: SkinBindState,
): boolean {
  if (typeof condition === "string") {
    return Boolean(evaluateSkinBind(condition, state));
  }
  if ("all" in condition) {
    return condition.all.every((child) => evaluateSkinCondition(child, state));
  }
  if ("any" in condition) {
    return condition.any.some((child) => evaluateSkinCondition(child, state));
  }
  if ("not" in condition) {
    return !evaluateSkinCondition(condition.not, state);
  }
  return false;
}

export function isSkinControlEnabled(
  enabledWhen: SkinCondition | undefined,
  state: SkinBindState,
): boolean {
  if (enabledWhen === undefined) return true;
  return evaluateSkinCondition(enabledWhen, state);
}

function playlistTrackCount(state: SkinBindState): number {
  return resolveSkinPlaylistTrackCount(state.playlistSourceId, {
    library: state.library,
    playbackTracks: state.playbackTracks,
    cdQueueTracks: state.cdQueueTracks,
    playContextIds: state.playContextIds,
    manualQueueIds: state.manualQueueIds,
    currentTrackId: state.currentTrackId,
    playlists: state.playlists,
  });
}

export function useSkinBindState(): SkinBindState {
  const alwaysOnTop = useSkinModeAlwaysOnTop();
  const { values: viewState } = useSkinViewState();
  const { state: slideshowState, presentations: slideshowPresentations } =
    useSkinSlideshowState();
  const { state: scrollStripState, presentations: scrollStripPresentations } =
    useSkinScrollStripState();
  const openAuxiliaryViews = useSkinStore((s) => s.openAuxiliaryViews);
  const playlistSourceId = useSkinStore((s) => s.playlistSourceId);
  const library = usePlayerStore((s) => s.library);
  const playbackTracks = usePlayerStore((s) => s.playbackTracks);
  const cdQueueContext = usePlayerStore((s) => s.cdQueueContext);
  const currentTrackId = usePlayerStore((s) => s.currentTrackId);
  const playbackState = usePlayerStore((s) => s.playbackState);
  const positionSeconds = usePlayerStore((s) => s.positionSeconds);
  const repeatMode = usePlayerStore((s) => s.repeatMode);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const muted = usePlayerStore((s) => s.muted);
  const playContextIds = usePlayerStore((s) => s.playContextIds);
  const manualQueueIds = usePlayerStore((s) => s.manualQueueIds);
  const currentPlayable = usePlayerStore((s) => s.currentPlayable);
  const playlists = usePlaylistStore((s) => s.playlists);
  const visualizers = useVisualizerStore((s) => s.visualizers);
  const activeVisualizerId = useVisualizerStore((s) => s.activeVisualizerId);
  const eqEnabled = useEqualizerStore((s) => s.enabled);
  const eqPresetId = useEqualizerStore((s) => s.presetId);
  const eqBands = useEqualizerStore((s) => s.bands);
  const eqCustomPresets = useEqualizerStore((s) => s.customPresets);
  const crossfadeEnabled = usePlaybackSettingsStore((s) => s.crossfadeEnabled);
  const skinPreferences = useSkinPreferencesStore((s) => s.preferences);
  const soundEffectsEnabled =
    soundEffectsEnabledFromPreferences(skinPreferences);

  const visualizerName = useMemo(
    () => activeVisualizerName(visualizers, activeVisualizerId),
    [visualizers, activeVisualizerId],
  );
  const canCycleVisualizer = useMemo(
    () => canCycleVisualizers(visualizers),
    [visualizers],
  );

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
    getNextSkippingKnownUnplayable(
      activeQueue,
      currentTrackId,
      repeatMode,
      library,
      getManualNextId,
    ) !== null;

  const bindState = useMemo(
    (): SkinBindState => ({
      currentTrack,
      artUrl,
      playbackState,
      positionSeconds,
      repeatMode,
      shuffle,
      // Live store reads: subscribing here would re-render every bind consumer
      // on each volume/balance pointermove (Headspace EQ + visualizer stutter).
      volume: usePlayerStore.getState().volume,
      balance: usePlayerStore.getState().balance,
      muted,
      canGoPrevious,
      canGoNext,
      activeQueueLength: activeQueue.length,
      currentTrackId,
      alwaysOnTop,
      currentPlayable,
      openAuxiliaryViews,
      visualizerName,
      canCycleVisualizer,
      playlistSourceId,
      library,
      playbackTracks,
      cdQueueTracks: cdQueueContext?.tracks,
      playContextIds,
      manualQueueIds,
      playlists,
      eqEnabled,
      eqPresetId,
      eqBands,
      eqCustomPresets,
      soundEffectsEnabled,
      crossfadeEnabled,
      viewState,
      slideshowPresentations,
      slideshowState,
      scrollStripPresentations,
      scrollStripState,
    }),
    [
      currentTrack,
      artUrl,
      playbackState,
      positionSeconds,
      repeatMode,
      shuffle,
      muted,
      canGoPrevious,
      canGoNext,
      activeQueue.length,
      currentTrackId,
      alwaysOnTop,
      currentPlayable,
      openAuxiliaryViews,
      visualizerName,
      canCycleVisualizer,
      playlistSourceId,
      library,
      playbackTracks,
      cdQueueContext?.tracks,
      playContextIds,
      manualQueueIds,
      playlists,
      eqEnabled,
      eqPresetId,
      eqBands,
      eqCustomPresets,
      soundEffectsEnabled,
      crossfadeEnabled,
      viewState,
      slideshowPresentations,
      slideshowState,
      scrollStripPresentations,
      scrollStripState,
    ],
  );
  return bindState;
}

export function useSkinBindValue(path: string | undefined): SkinBindValue {
  const bindState = useSkinBindState();

  return useMemo((): SkinBindValue => {
    if (!path) return null;
    return evaluateSkinBind(path as SkinBindPath, bindState);
  }, [path, bindState]);
}

/** True when `visibleWhen` condition is truthy (or unset). */
export function useSkinVisible(
  visibleWhen: SkinCondition | undefined,
): boolean {
  const bindState = useSkinBindState();
  if (!visibleWhen) return true;
  return evaluateSkinCondition(visibleWhen, bindState);
}

export function useSkinControlEnabled(
  enabledWhen: SkinCondition | undefined,
): boolean {
  const bindState = useSkinBindState();
  return isSkinControlEnabled(enabledWhen, bindState);
}
