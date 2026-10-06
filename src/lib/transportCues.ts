import {
  CORE_TRANSPORT_CONTROL_SOUND_ID,
  CORE_TRANSPORT_PLAY_SOUND_ID,
  resolveSoundAssetUrl,
} from "./packSounds";
import { playOneShot } from "./sfxPlayer";

/** Play uses its own cue. Pause and the other controls share one. */
export type TransportCue = "play" | "control";

function soundIdForCue(cue: TransportCue): string {
  return cue === "play"
    ? CORE_TRANSPORT_PLAY_SOUND_ID
    : CORE_TRANSPORT_CONTROL_SOUND_ID;
}

/** Library transport cues — independent of the active skin sound preference. */
export function playTransportCue(cue: TransportCue): void {
  void resolveSoundAssetUrl(soundIdForCue(cue)).then((url) => {
    if (!url) {
      console.error("Failed to resolve transport cue sound:", cue);
      return;
    }
    playOneShot(url);
  });
}
