import { SOUND_CUES, type SoundCue } from "../types/soundPack";
import { resolveCueUrl } from "./packSounds";
import { playOneShot } from "./sfxPlayer";

/** Play uses its own cue. Pause and the other controls share one. */
export type TransportCue = "play" | "control";

function soundCueFor(cue: TransportCue): SoundCue {
  return cue === "play"
    ? SOUND_CUES.transportPlay
    : SOUND_CUES.transportControl;
}

/** Library transport cues — independent of the active skin sound preference. */
export function playTransportCue(cue: TransportCue): void {
  void resolveCueUrl(soundCueFor(cue)).then((url) => {
    if (!url) {
      console.error("Failed to resolve transport cue sound:", cue);
      return;
    }
    playOneShot(url);
  });
}
