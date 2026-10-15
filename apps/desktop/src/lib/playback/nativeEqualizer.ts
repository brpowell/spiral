import { invoke } from "@tauri-apps/api/core";
import type { EqualizerState } from "../equalizer/types";
import { isNativeAudioEnabled } from "./nativeAudioFlag";

type EqualizerParams = Pick<EqualizerState, "enabled" | "bands" | "preampGain">;

/**
 * Last EQ state the UI applied. Kept even while native output is off or not yet
 * known, because the equalizer bootstraps before the playback settings do.
 */
let lastState: EqualizerParams | null = null;

/** Record the state and, when native output is on, hand it to the Rust mixer. */
export function applyNativeEqualizer(state: EqualizerParams): void {
  lastState = {
    enabled: state.enabled,
    bands: [...state.bands] as unknown as EqualizerState["bands"],
    preampGain: state.preampGain,
  };
  pushNativeEqualizer();
}

/** Send the remembered EQ state to Rust (no-op unless native output is on). */
export function pushNativeEqualizer(): void {
  if (!lastState || !isNativeAudioEnabled()) return;
  void invoke("set_native_equalizer", {
    enabled: lastState.enabled,
    bandsDb: [...lastState.bands],
    preampDb: lastState.preampGain,
  }).catch((err) => console.error("Native equalizer update failed:", err));
}
