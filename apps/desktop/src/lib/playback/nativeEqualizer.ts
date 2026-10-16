import { invoke } from "@tauri-apps/api/core";
import type { EqualizerState } from "../equalizer/types";

type EqualizerParams = Pick<EqualizerState, "enabled" | "bands" | "preampGain">;

/**
 * Last EQ state the UI applied. Kept so it can be replayed whenever a session
 * loads: the equalizer bootstraps early and Rust may not have seen it yet.
 */
let lastState: EqualizerParams | null = null;

/** Record the state and hand it to the Rust mixer. */
export function applyEqualizerState(state: EqualizerParams): void {
  lastState = {
    enabled: state.enabled,
    bands: [...state.bands] as unknown as EqualizerState["bands"],
    preampGain: state.preampGain,
  };
  pushNativeEqualizer();
}

/** Send the remembered EQ state to Rust. */
export function pushNativeEqualizer(): void {
  if (!lastState) return;
  void invoke("set_native_equalizer", {
    enabled: lastState.enabled,
    bandsDb: [...lastState.bands],
    preampDb: lastState.preampGain,
  }).catch((err) => console.error("Native equalizer update failed:", err));
}
