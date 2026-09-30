import { Howl } from "howler";
import {
  CORE_TRANSPORT_CONTROL_SOUND_ID,
  CORE_TRANSPORT_PLAY_SOUND_ID,
  resolveSoundAssetUrl,
} from "./packSounds";

/** Play uses its own cue. Pause and the other controls share one. */
export type TransportCue = "play" | "control";

const cues = new Map<TransportCue, Howl>();
const inflight = new Map<TransportCue, Promise<Howl | null>>();

function soundIdForCue(cue: TransportCue): string {
  return cue === "play"
    ? CORE_TRANSPORT_PLAY_SOUND_ID
    : CORE_TRANSPORT_CONTROL_SOUND_ID;
}

async function howlFor(cue: TransportCue): Promise<Howl | null> {
  const cached = cues.get(cue);
  if (cached) return cached;

  const pending = inflight.get(cue);
  if (pending) return pending;

  const load = (async () => {
    const url = await resolveSoundAssetUrl(soundIdForCue(cue));
    if (!url) {
      console.error("Failed to resolve transport cue sound:", cue);
      return null;
    }
    const howl = new Howl({
      src: [url],
      volume: 1,
      html5: false,
      preload: true,
    });
    cues.set(cue, howl);
    return howl;
  })().finally(() => {
    inflight.delete(cue);
  });

  inflight.set(cue, load);
  return load;
}

function playHowl(howl: Howl): void {
  const playLoaded = () => {
    howl.stop();
    howl.play();
  };
  if (howl.state() === "loaded") {
    playLoaded();
    return;
  }
  howl.once("load", playLoaded);
  howl.once("loaderror", (_id, err) => {
    console.error("Failed to load transport cue:", err);
  });
}

/** Library transport cues — independent of the active skin sound preference. */
export function playTransportCue(cue: TransportCue): void {
  void howlFor(cue).then((howl) => {
    if (howl) playHowl(howl);
  });
}
