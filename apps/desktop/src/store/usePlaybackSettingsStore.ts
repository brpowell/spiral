import { create } from "zustand";
import { savePlaybackSettings } from "../lib/tauri";
import {
  clampCrossfadeSeconds,
  defaultPlaybackSettings,
  type PlaybackSettings,
} from "../types/playbackSettings";
import { setNativeAudioEnabled } from "../lib/playback/nativeAudioFlag";
import { getWindowRole } from "../lib/windowRole";

interface PlaybackSettingsStoreState extends PlaybackSettings {
  initializeFromBootstrap: (settings: PlaybackSettings) => void;
  applySnapshot: (snapshot: PlaybackSettings) => void;
  setCrossfadeEnabled: (enabled: boolean) => void;
  toggleCrossfade: () => void;
  setCrossfadeSeconds: (seconds: number) => void;
  setCrossfadeOnSkip: (enabled: boolean) => void;
  setCrossfadeVisualEnabled: (enabled: boolean) => void;
}

function isMainWindow(): boolean {
  return getWindowRole() === "main";
}

type UserPlaybackSettings = Omit<PlaybackSettings, "nativeAudioOutput">;

function persistPlaybackSettings(state: UserPlaybackSettings): void {
  if (!isMainWindow()) return;

  void savePlaybackSettings({
    crossfadeEnabled: state.crossfadeEnabled,
    crossfadeSeconds: state.crossfadeSeconds,
    crossfadeOnSkip: state.crossfadeOnSkip,
    crossfadeVisualEnabled: state.crossfadeVisualEnabled,
    // Not editable in the UI yet; carry it through so saves never reset it.
    nativeAudioOutput: usePlaybackSettingsStore.getState().nativeAudioOutput,
  }).catch((err: unknown) => {
    console.error("Failed to save playback settings:", err);
  });
}

function commitSettingsChange(state: UserPlaybackSettings): void {
  persistPlaybackSettings(state);
}

export const usePlaybackSettingsStore = create<PlaybackSettingsStoreState>(
  (set, get) => ({
    ...defaultPlaybackSettings(),

    initializeFromBootstrap: (settings) => {
      setNativeAudioEnabled(settings.nativeAudioOutput === true);
      set({
        crossfadeEnabled: settings.crossfadeEnabled,
        crossfadeSeconds: clampCrossfadeSeconds(settings.crossfadeSeconds),
        crossfadeOnSkip: settings.crossfadeOnSkip,
        crossfadeVisualEnabled: settings.crossfadeVisualEnabled,
        nativeAudioOutput: settings.nativeAudioOutput === true,
      });
    },

    applySnapshot: (snapshot) => {
      set({
        crossfadeEnabled: snapshot.crossfadeEnabled,
        crossfadeSeconds: clampCrossfadeSeconds(snapshot.crossfadeSeconds),
        crossfadeOnSkip: snapshot.crossfadeOnSkip,
        crossfadeVisualEnabled: snapshot.crossfadeVisualEnabled,
      });
    },

    setCrossfadeEnabled: (enabled) => {
      const next = {
        crossfadeEnabled: enabled,
        crossfadeSeconds: get().crossfadeSeconds,
        crossfadeOnSkip: get().crossfadeOnSkip,
        crossfadeVisualEnabled: get().crossfadeVisualEnabled,
      };
      set({ crossfadeEnabled: enabled });
      commitSettingsChange(next);
    },

    toggleCrossfade: () => {
      get().setCrossfadeEnabled(!get().crossfadeEnabled);
    },

    setCrossfadeSeconds: (seconds) => {
      const crossfadeSeconds = clampCrossfadeSeconds(seconds);
      const next = {
        crossfadeEnabled: get().crossfadeEnabled,
        crossfadeSeconds,
        crossfadeOnSkip: get().crossfadeOnSkip,
        crossfadeVisualEnabled: get().crossfadeVisualEnabled,
      };
      set({ crossfadeSeconds });
      commitSettingsChange(next);
    },

    setCrossfadeOnSkip: (enabled) => {
      const next = {
        crossfadeEnabled: get().crossfadeEnabled,
        crossfadeSeconds: get().crossfadeSeconds,
        crossfadeOnSkip: enabled,
        crossfadeVisualEnabled: get().crossfadeVisualEnabled,
      };
      set({ crossfadeOnSkip: enabled });
      commitSettingsChange(next);
    },

    setCrossfadeVisualEnabled: (enabled) => {
      const next = {
        crossfadeEnabled: get().crossfadeEnabled,
        crossfadeSeconds: get().crossfadeSeconds,
        crossfadeOnSkip: get().crossfadeOnSkip,
        crossfadeVisualEnabled: enabled,
      };
      set({ crossfadeVisualEnabled: enabled });
      commitSettingsChange(next);
    },
  }),
);

export function pickPlaybackSettingsSnapshot(
  state: PlaybackSettings,
): PlaybackSettings {
  return {
    crossfadeEnabled: state.crossfadeEnabled,
    crossfadeSeconds: state.crossfadeSeconds,
    crossfadeOnSkip: state.crossfadeOnSkip,
    crossfadeVisualEnabled: state.crossfadeVisualEnabled,
    nativeAudioOutput: state.nativeAudioOutput,
  };
}
