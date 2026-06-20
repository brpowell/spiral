import { create } from "zustand";
import {
  isKnownPresetId,
  resolvePreset,
} from "../lib/equalizer/builtinPresets";
import {
  clampPreampGain,
  FLAT_BAND_GAINS,
  normalizeBandGains,
  type EqualizerBandGains,
  type EqualizerPreset,
  type EqualizerStateSnapshot,
} from "../lib/equalizer/types";
import { applyEqualizerState } from "../lib/playback/audioOutput";
import {
  deleteEqualizerCustomPreset,
  saveEqualizerCustomPreset,
  saveEqualizerSettings,
  type EqualizerPresetRecord,
  type EqualizerSettings,
} from "../lib/tauri";
import { getWindowRole } from "../lib/windowRole";

interface EqualizerStoreState {
  enabled: boolean;
  presetId: string;
  /** Last explicitly selected preset; used when reset restores bands after manual edits. */
  lastPresetId: string;
  bands: EqualizerBandGains;
  preampGain: number;
  customPresets: EqualizerPreset[];
  initializeFromBootstrap: (settings: EqualizerSettings) => void;
  loadCustomPresets: (presets: EqualizerPreset[]) => void;
  setBand: (index: number, gain: number) => void;
  setPreampGain: (gain: number) => void;
  applyPreset: (presetId: string) => void;
  reset: () => void;
  setEnabled: (enabled: boolean) => void;
  saveCurrentAsPreset: (name: string) => void;
  renameCustomPreset: (id: string, name: string) => void;
  deleteCustomPreset: (id: string) => void;
  applySnapshot: (snapshot: EqualizerStateSnapshot) => void;
}

type EqualizerAudioState = Pick<
  EqualizerStoreState,
  "enabled" | "bands" | "preampGain"
>;

type EqualizerPersistedState = Pick<
  EqualizerStoreState,
  "enabled" | "presetId" | "bands" | "preampGain"
>;

function isMainWindow(): boolean {
  return getWindowRole() === "main";
}

function commitAudioState(state: EqualizerAudioState): void {
  if (!isMainWindow()) return;
  applyEqualizerState(state);
}

function persistEqualizerState(state: EqualizerPersistedState): void {
  if (!isMainWindow()) return;

  void saveEqualizerSettings({
    enabled: state.enabled,
    presetId: state.presetId,
    bands: [...state.bands],
    preampGain: state.preampGain,
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

function commitStateChange(state: EqualizerPersistedState): void {
  commitAudioState(state);
  persistEqualizerState(state);
}

function recordToPreset(record: EqualizerPresetRecord): EqualizerPreset {
  return {
    id: record.id,
    name: record.name,
    bands: normalizeBandGains(record.bands),
    builtin: false,
  };
}

function presetToRecord(preset: EqualizerPreset): EqualizerPresetRecord {
  return {
    id: preset.id,
    name: preset.name,
    bands: [...preset.bands],
  };
}

function resolvePresetId(
  presetId: string,
  customPresets: EqualizerPreset[],
): string {
  if (isKnownPresetId(presetId, customPresets)) {
    return presetId;
  }
  return "flat";
}

export const useEqualizerStore = create<EqualizerStoreState>((set, get) => ({
  enabled: true,
  presetId: "flat",
  lastPresetId: "flat",
  bands: FLAT_BAND_GAINS,
  preampGain: 0,
  customPresets: [],

  initializeFromBootstrap: (settings) => {
    const customPresets = get().customPresets;
    const bands = normalizeBandGains(settings.bands);
    const presetId = resolvePresetId(settings.presetId, customPresets);

    const next = {
      enabled: settings.enabled,
      presetId,
      lastPresetId: presetId === "manual" ? "flat" : presetId,
      bands,
      preampGain: clampPreampGain(settings.preampGain ?? 0),
    };

    set(next);
    commitAudioState(next);
  },

  loadCustomPresets: (presets) => {
    set({ customPresets: presets });
  },

  setBand: (index, gain) => {
    if (index < 0 || index >= get().bands.length) return;

    const next = {
      enabled: get().enabled,
      presetId: "manual",
      bands: updateBands(get().bands, index, gain),
      preampGain: get().preampGain,
    };

    set(next);
    commitStateChange(next);
  },

  setPreampGain: (gain) => {
    const next = {
      enabled: get().enabled,
      presetId: get().presetId,
      bands: get().bands,
      preampGain: clampPreampGain(gain),
    };

    set({ preampGain: next.preampGain });
    commitStateChange(next);
  },

  applyPreset: (presetId) => {
    const preset = resolvePreset(presetId, get().customPresets);
    if (!preset) return;

    const next = {
      enabled: get().enabled,
      presetId,
      lastPresetId: presetId,
      bands: preset.bands,
      preampGain: get().preampGain,
    };

    set(next);
    commitStateChange(next);
  },

  reset: () => {
    const { presetId, lastPresetId } = get();
    const targetPresetId = presetId === "manual" ? lastPresetId : presetId;
    get().applyPreset(targetPresetId);
  },

  setEnabled: (enabled) => {
    const next = {
      enabled,
      presetId: get().presetId,
      bands: get().bands,
      preampGain: get().preampGain,
    };

    set({ enabled });
    commitStateChange(next);
  },

  saveCurrentAsPreset: (name) => {
    const trimmed = name.trim();
    if (!trimmed || !isMainWindow()) return;

    const preset: EqualizerPreset = {
      id: crypto.randomUUID(),
      name: trimmed,
      bands: get().bands,
      builtin: false,
    };

    const customPresets = [...get().customPresets, preset];
    const next = {
      enabled: get().enabled,
      presetId: preset.id,
      lastPresetId: preset.id,
      bands: get().bands,
      preampGain: get().preampGain,
    };

    set({ ...next, customPresets });

    void saveEqualizerCustomPreset(presetToRecord(preset)).catch(
      (err: unknown) => {
        console.error("Failed to save equalizer custom preset:", err);
      },
    );
    persistEqualizerState(next);
  },

  renameCustomPreset: (id, name) => {
    const trimmed = name.trim();
    if (!trimmed || !isMainWindow()) return;

    const preset = get().customPresets.find((item) => item.id === id);
    if (!preset || preset.builtin) return;

    const updated: EqualizerPreset = { ...preset, name: trimmed };
    const customPresets = get().customPresets.map((item) =>
      item.id === id ? updated : item,
    );

    set({ customPresets });

    void saveEqualizerCustomPreset(presetToRecord(updated)).catch(
      (err: unknown) => {
        console.error("Failed to rename equalizer custom preset:", err);
      },
    );
  },

  deleteCustomPreset: (id) => {
    if (!isMainWindow()) return;

    const preset = get().customPresets.find((item) => item.id === id);
    if (!preset || preset.builtin) return;

    const wasActive = get().presetId === id;
    const customPresets = get().customPresets.filter((item) => item.id !== id);
    const presetId = wasActive ? "flat" : get().presetId;
    const lastPresetId = wasActive ? "flat" : get().lastPresetId;
    const next = {
      enabled: get().enabled,
      presetId,
      lastPresetId,
      bands: get().bands,
      preampGain: get().preampGain,
    };

    set({ customPresets, presetId, lastPresetId });

    void deleteEqualizerCustomPreset(id).catch((err: unknown) => {
      console.error("Failed to delete equalizer custom preset:", err);
    });

    if (wasActive) {
      persistEqualizerState(next);
    }
  },

  applySnapshot: (snapshot) => {
    const presetId = snapshot.presetId;
    set({
      enabled: snapshot.enabled,
      presetId,
      lastPresetId: presetId === "manual" ? get().lastPresetId : presetId,
      bands: normalizeBandGains(snapshot.bands),
      preampGain: clampPreampGain(snapshot.preampGain),
      customPresets: snapshot.customPresets,
    });
  },
}));

export { recordToPreset };
