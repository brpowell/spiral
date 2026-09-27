import { useEffect, useMemo, useState } from "react";
import * as audio from "./playback";
import { subscribePlaybackClock } from "./playbackClock";
import { presetLabel } from "./equalizer/builtinPresets";
import { formatTime, formatRemainingTime } from "./format";
import { buildPlaybackOrder } from "./playbackOrder";
import { findPlaybackTrack } from "./playbackTrack";
import { getManualNextId } from "./playbackQueue";
import { getNextSkippingKnownUnplayable } from "./playbackSkip";
import { formatMetadataLine, playbackStatus } from "./skinMetadataLine";
import { useSkinModeAlwaysOnTop } from "./skinModeAlwaysOnTop";
import { isAnySkinWindow } from "./windowRole";
import { evaluateSlideshowBind } from "./skinSlideshow";
import { evaluateScrollStripBind } from "./skinScrollStrip";
import { evaluateStateBind, useSkinViewState } from "./skinViewStateContext";
import { useSkinHoveredNodeIds } from "./skinHoverContext";
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
import type { SkinUserPreferences } from "../types/skinPreferences";
import { evaluateAuthorSkinPref } from "./skinPrefSettings";
import type { EqualizerBandGains, EqualizerPreset } from "./equalizer/types";
import type { PlayableRef } from "../types/playable";
import type {
  ScrollStripPresentation,
  SkinBindPath,
  SkinCondition,
  SkinSetting,
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
  playlistFilterQuery: string;
  inputValues: Record<string, string>;
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
  skinSettings: readonly SkinSetting[];
  skinPreferences: SkinUserPreferences;
  viewState: ViewStateValues;
  slideshowPresentations: Record<string, SlideshowPresentation>;
  slideshowState: SlideshowStateMap;
  scrollStripPresentations: Record<string, ScrollStripPresentation>;
  scrollStripState: ScrollStripStateMap;
  /** Node ids currently under the pointer (`hover.{nodeId}`). */
  hoveredNodeIds: ReadonlySet<string>;
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

  const viewValue = evaluateStateBind(path, state.viewState);
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

  if (path.startsWith("hover.")) {
    const id = path.slice("hover.".length);
    return id.length > 0 && !id.includes(".") && state.hoveredNodeIds.has(id);
  }

  const inputBind = evaluateInputBind(path, state.inputValues);
  if (inputBind !== null) {
    return inputBind;
  }

  if (path.startsWith("skin.pref.")) {
    const key = path.slice("skin.pref.".length);
    if (key === "soundEffectsEnabled") {
      return state.soundEffectsEnabled;
    }
    const authorValue = evaluateAuthorSkinPref(
      key,
      state.skinSettings,
      state.skinPreferences,
    );
    if (authorValue !== null) {
      return authorValue;
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
    case "track.rating":
      return currentTrack?.rating ?? null;
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
    case "playlist.filterQuery":
      return state.playlistFilterQuery;
    case "playlist.hasFilter":
      return state.playlistFilterQuery.trim().length > 0;
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
  if (typeof condition === "boolean") {
    return condition;
  }
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

function evaluateInputBind(
  path: string,
  inputValues: Record<string, string>,
): SkinBindValue | null {
  if (!path.startsWith("input.")) return null;
  const rest = path.slice("input.".length);
  const dot = rest.indexOf(".");
  if (dot <= 0) return null;
  const id = rest.slice(0, dot);
  const prop = rest.slice(dot + 1);
  if (!id || id.includes(".")) return null;
  const value = inputValues[id] ?? "";
  if (prop === "value") return value;
  if (prop === "empty") return value.trim().length === 0;
  return null;
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
    filterQuery: state.playlistFilterQuery,
  });
}

export function useSkinBindState(): SkinBindState {
  const alwaysOnTop = useSkinModeAlwaysOnTop();
  const { values: viewState } = useSkinViewState();
  const { state: slideshowState, presentations: slideshowPresentations } =
    useSkinSlideshowState();
  const { state: scrollStripState, presentations: scrollStripPresentations } =
    useSkinScrollStripState();
  const hoveredNodeIds = useSkinHoveredNodeIds();
  const openAuxiliaryViews = useSkinStore((s) => s.openAuxiliaryViews);
  const playlistSourceId = useSkinStore((s) => s.playlistSourceId);
  const playlistFilterQuery = useSkinStore((s) => s.playlistFilterQuery);
  const inputValues = useSkinStore((s) => s.inputValues);
  const library = usePlayerStore((s) => s.library);
  const playbackTracks = usePlayerStore((s) => s.playbackTracks);
  const cdQueueContext = usePlayerStore((s) => s.cdQueueContext);
  const currentTrackId = usePlayerStore((s) => s.currentTrackId);
  const playbackState = usePlayerStore((s) => s.playbackState);
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
  const activePack = useSkinStore((s) => s.activePack);
  const skinSettings = activePack?.manifest.settings ?? [];

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
      // Live read: subscribing would re-render every bind consumer on the
      // playhead poll. Time labels refresh through useSkinBindValue.
      positionSeconds: audio.getPositionSeconds(),
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
      playlistFilterQuery,
      inputValues,
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
      skinSettings,
      skinPreferences,
      viewState,
      slideshowPresentations,
      slideshowState,
      scrollStripPresentations,
      scrollStripState,
      hoveredNodeIds,
    }),
    [
      currentTrack,
      artUrl,
      playbackState,
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
      playlistFilterQuery,
      inputValues,
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
      skinSettings,
      skinPreferences,
      viewState,
      slideshowPresentations,
      slideshowState,
      scrollStripPresentations,
      scrollStripState,
      hoveredNodeIds,
    ],
  );
  return bindState;
}

const PLAYHEAD_BINDS = new Set([
  "player.positionSeconds",
  "player.positionLabel",
  "player.remainingLabel",
]);

function usePlayheadSecond(enabled: boolean): number {
  const followsStore = isAnySkinWindow();
  const storeSecond = usePlayerStore((s) =>
    enabled && followsStore ? Math.floor(s.positionSeconds) : 0,
  );
  const [audioSecond, setAudioSecond] = useState(() =>
    Math.floor(audio.getPositionSeconds()),
  );
  useEffect(() => {
    if (!enabled || followsStore) return;
    return subscribePlaybackClock((seconds) => {
      const next = Math.floor(seconds);
      setAudioSecond((prev) => (prev === next ? prev : next));
    });
  }, [enabled, followsStore]);
  return followsStore ? storeSecond : audioSecond;
}

export function useSkinBindValue(path: string | undefined): SkinBindValue {
  const bindState = useSkinBindState();
  const playheadBind = path !== undefined && PLAYHEAD_BINDS.has(path);
  const playheadSecond = usePlayheadSecond(playheadBind);

  return useMemo((): SkinBindValue => {
    if (!path) return null;
    const positionSeconds = isAnySkinWindow()
      ? usePlayerStore.getState().positionSeconds
      : audio.getPositionSeconds();
    const state = playheadBind ? { ...bindState, positionSeconds } : bindState;
    return evaluateSkinBind(path as SkinBindPath, state);
  }, [path, bindState, playheadBind, playheadSecond]);
}

export function isSkinVisible(
  visibleWhen: SkinCondition | undefined,
  state: SkinBindState,
): boolean {
  if (visibleWhen === undefined) return true;
  return evaluateSkinCondition(visibleWhen, state);
}

/** True when `visibleWhen` condition is truthy (or unset). */
export function useSkinVisible(
  visibleWhen: SkinCondition | undefined,
): boolean {
  const bindState = useSkinBindState();
  return isSkinVisible(visibleWhen, bindState);
}

export function useSkinControlEnabled(
  enabledWhen: SkinCondition | undefined,
): boolean {
  const bindState = useSkinBindState();
  return isSkinControlEnabled(enabledWhen, bindState);
}
