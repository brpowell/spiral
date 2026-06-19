import { create } from "zustand";
import { getBuiltinPreset } from "../lib/equalizer/builtinPresets";
import {
  FLAT_BAND_GAINS,
  normalizeBandGains,
  type EqualizerBandGains,
  type EqualizerPreset,
  type EqualizerStateSnapshot,
} from "../lib/equalizer/types";
import { applyEqualizerState } from "../lib/playback/audioOutput";
import { saveEqualizerSettings, type EqualizerSettings } from "../lib/tauri";
import { getWindowRole } from "../lib/windowRole";

interface EqualizerStoreState {
  enabled: boolean;
  presetId: string;
  bands: EqualizerBandGains;
  customPresets: EqualizerPreset[];
  initializeFromBootstrap: (settings: EqualizerSettings) => void;
  setBand: (index: number, gain: number) => void;
  applyPreset: (presetId: string) => void;
  reset: () => void;
  setEnabled: (enabled: boolean) => void;
  applySnapshot: (snapshot: EqualizerStateSnapshot) => void;
}

function isMainWindow(): boolean {
  return getWindowRole() === "main";
}

function commitAudioState(
  state: Pick<EqualizerStoreState, "enabled" | "bands">,
): void {
  if (!isMainWindow()) return;
  applyEqualizerState({ enabled: state.enabled, bands: state.bands });
}

function persistEqualizerState(
  state: Pick<EqualizerStoreState, "enabled" | "presetId" | "bands">,
): void {
  if (!isMainWindow()) return;

  void saveEqualizerSettings({
    enabled: state.enabled,
    presetId: state.presetId,
    bands: [...state.bands],
  }).catch((err: unknown) => {
    console.error("Failed to save equalizer settings:", err);
  });
}

function updateBands(
  bands: EqualizerBandGains,
  index: number,
  gain: number,
): EqualizerBandGains {
  const next = [...bands] as number[];
  next[index] = gain;
  return normalizeBandGains(next);
}

function commitStateChange(
  state: Pick<EqualizerStoreState, "enabled" | "presetId" | "bands">,
): void {
  commitAudioState(state);
  persistEqualizerState(state);
}

export const useEqualizerStore = create<EqualizerStoreState>((set, get) => ({
  enabled: true,
  presetId: "flat",
  bands: FLAT_BAND_GAINS,
  customPresets: [],

  initializeFromBootstrap: (settings) => {
    const bands = normalizeBandGains(settings.bands);
    const presetId =
      settings.presetId === "manual" || getBuiltinPreset(settings.presetId)
        ? settings.presetId
        : "flat";

    const next = {
      enabled: settings.enabled,
      presetId,
      bands,
    };

    set(next);
    commitAudioState(next);
  },

  setBand: (index, gain) => {
    if (index < 0 || index >= get().bands.length) return;

    const next = {
      enabled: get().enabled,
      presetId: "manual",
      bands: updateBands(get().bands, index, gain),
    };

    set(next);
    commitStateChange(next);
  },

  applyPreset: (presetId) => {
    const preset = getBuiltinPreset(presetId);
    if (!preset) return;

    const next = {
      enabled: get().enabled,
      presetId,
      bands: preset.bands,
    };

    set(next);
    commitStateChange(next);
  },

  reset: () => {
    const next = {
      enabled: get().enabled,
      presetId: "manual",
      bands: FLAT_BAND_GAINS,
    };

    set(next);
    commitStateChange(next);
  },

  setEnabled: (enabled) => {
    const next = {
      enabled,
      presetId: get().presetId,
      bands: get().bands,
    };

    set({ enabled });
    commitStateChange(next);
  },

  applySnapshot: (snapshot) => {
    set({
      enabled: snapshot.enabled,
      presetId: snapshot.presetId,
      bands: normalizeBandGains(snapshot.bands),
    });
  },
}));

declare global {
  interface Window {
    useEqualizerStore?: typeof useEqualizerStore;
  }
}

if (import.meta.env.DEV && typeof window !== "undefined") {
  window.useEqualizerStore = useEqualizerStore;
}
