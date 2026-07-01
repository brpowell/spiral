import { useMemo } from "react";
import { presetLabel } from "./equalizer/builtinPresets";
import { formatTime, formatRemainingTime } from "./format";
import { buildPlaybackOrder } from "./playbackOrder";
import { findPlaybackTrack } from "./playbackTrack";
import { getManualNextId } from "./playbackQueue";
import { getNextSkippingKnownUnplayable } from "./playbackSkip";
import { formatMetadataLine, playbackStatus } from "./skinMetadataLine";
import { useSkinModeAlwaysOnTop } from "./skinModeAlwaysOnTop";
import { evaluatePanelBind } from "./skinPanels";
import { evaluateSlideshowBind } from "./skinSlideshow";
import { evaluateViewBind, useSkinViewState } from "./skinViewStateContext";
import { useSkinSlideshowState } from "./skinSlideshowContext";
import {
  labelForSkinPlaylistSource,
  resolveSkinPlaylistTrackCount,
} from "./skinPlaylist";
import {
  activeVisualizerName,
  canCycleVisualizers,
} from "./visualizerCycle";
import { useAssetUrl } from "../hooks/useAssetUrl";
import { usePlayerStore } from "../store/usePlayerStore";
import { usePlaylistStore } from "../store/usePlaylistStore";
import { useSkinStore } from "../store/useSkinStore";
import { useVisualizerStore } from "../store/useVisualizerStore";
import { useEqualizerStore } from "../store/useEqualizerStore";
import { useSkinPreferencesStore } from "../store/useSkinPreferencesStore";
import { soundEffectsEnabledFromPreferences } from "../types/skinPreferences";
import type { EqualizerBandGains, EqualizerPreset } from "./equalizer/types";
import type { PlayableRef } from "../types/playable";
import type { SkinBindPath } from "../types/skin";
import type { Track } from "../types/track";
import type { Playlist } from "../types/playlist";
import type { PanelOpenState } from "./skinPanels";
import type { SlideshowPresentation } from "../types/skin";
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
  panelOpen: PanelOpenState;
  panelRevealed: PanelOpenState;
  panelSettled: PanelOpenState;
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
  viewState: ViewStateValues;
  slideshowPresentations: Record<string, SlideshowPresentation>;
  slideshowState: SlideshowStateMap;
}

export function evaluateSkinBind(
  path: SkinBindPath | string,
  state: SkinBindState,
): SkinBindValue {
  const panelValue = evaluatePanelBind(
    path,
    state.panelOpen,
    state.panelRevealed,
    state.panelSettled,
  );
  if (panelValue !== null) {
    return panelValue;
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
      return Math.round(state.volume * 100);
    case "player.repeatMode":
      return state.repeatMode;
    case "player.repeatOn":
      return state.repeatMode !== "off";
    case "player.shuffle":
      return state.shuffle;
    case "player.volume":
      return state.volume;
    case "player.balance":
      return state.balance;
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
      return labelForSkinPlaylistSource(state.playlistSourceId, state.playlists);
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
  const panelOpen = useSkinStore((s) => s.panelOpen);
  const panelRevealed = useSkinStore((s) => s.panelRevealed);
  const panelSettled = useSkinStore((s) => s.panelSettled);
  const playlistSourceId = useSkinStore((s) => s.playlistSourceId);
  const library = usePlayerStore((s) => s.library);
  const playbackTracks = usePlayerStore((s) => s.playbackTracks);
  const cdQueueContext = usePlayerStore((s) => s.cdQueueContext);
  const currentTrackId = usePlayerStore((s) => s.currentTrackId);
  const playbackState = usePlayerStore((s) => s.playbackState);
  const positionSeconds = usePlayerStore((s) => s.positionSeconds);
  const repeatMode = usePlayerStore((s) => s.repeatMode);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const volume = usePlayerStore((s) => s.volume);
  const balance = usePlayerStore((s) => s.balance);
  const muted = usePlayerStore((s) => s.muted);
  const playContextIds = usePlayerStore((s) => s.playContextIds);
  const manualQueueIds = usePlayerStore((s) => s.manualQueueIds);
  const currentPlayable = usePlayerStore((s) => s.currentPlayable);
  const playlists = usePlaylistStore((s) => s.playlists);
  const visualizerPacks = useVisualizerStore((s) => s.packs);
  const activeVisualizerId = useVisualizerStore((s) => s.activePackId);
  const eqEnabled = useEqualizerStore((s) => s.enabled);
  const eqPresetId = useEqualizerStore((s) => s.presetId);
  const eqBands = useEqualizerStore((s) => s.bands);
  const eqCustomPresets = useEqualizerStore((s) => s.customPresets);
  const skinPreferences = useSkinPreferencesStore((s) => s.preferences);
  const soundEffectsEnabled = soundEffectsEnabledFromPreferences(skinPreferences);

  const visualizerName = useMemo(
    () => activeVisualizerName(visualizerPacks, activeVisualizerId),
    [visualizerPacks, activeVisualizerId],
  );
  const canCycleVisualizer = useMemo(
    () => canCycleVisualizers(visualizerPacks),
    [visualizerPacks],
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

  return useMemo(
    (): SkinBindState => ({
      currentTrack,
      artUrl,
      playbackState,
      positionSeconds,
      repeatMode,
      shuffle,
      volume,
      balance,
      muted,
      canGoPrevious,
      canGoNext,
      activeQueueLength: activeQueue.length,
      currentTrackId,
      alwaysOnTop,
      currentPlayable,
      panelOpen,
      panelRevealed,
      panelSettled,
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
      viewState,
      slideshowPresentations,
      slideshowState,
    }),
    [
      currentTrack,
      artUrl,
      playbackState,
      positionSeconds,
      repeatMode,
      shuffle,
      volume,
      balance,
      muted,
      canGoPrevious,
      canGoNext,
      activeQueue.length,
      currentTrackId,
      alwaysOnTop,
      currentPlayable,
      panelOpen,
      panelRevealed,
      panelSettled,
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
      viewState,
      slideshowPresentations,
      slideshowState,
    ],
  );
}

export function useSkinBindValue(path: string | undefined): SkinBindValue {
  const bindState = useSkinBindState();

  return useMemo((): SkinBindValue => {
    if (!path) return null;
    return evaluateSkinBind(path as SkinBindPath, bindState);
  }, [path, bindState]);
}

/** True when `visibleWhen` bind is truthy (or unset). */
export function useSkinVisible(visibleWhen: string | undefined): boolean {
  const value = useSkinBindValue(visibleWhen);
  if (!visibleWhen) return true;
  return Boolean(value);
}

/** Disabled when `disabledWhen` bind is falsy (for canGo* / hasTrack style guards). */
export function isSkinBindDisabled(
  disabledWhen: string | undefined,
  state: SkinBindState,
): boolean {
  if (!disabledWhen) return false;
  return !evaluateSkinBind(disabledWhen as SkinBindPath, state);
}

export function useSkinDisabled(disabledWhen: string | undefined): boolean {
  const bindState = useSkinBindState();
  return isSkinBindDisabled(disabledWhen, bindState);
}
