import { getSkinViewStateApi } from "./skinViewStateContext";
import { playActiveSkinSound } from "./skinSoundEffects";

/** T3 main view `onTimer` intro delay before playing the open animation. */
export const SHUTTER_INTRO_DELAY_MS = 1000;

export function isShutterAnimating(phase: unknown): boolean {
  return phase === "opening" || phase === "closing";
}

export function playShutterOpen(): void {
  const api = getSkinViewStateApi();
  if (!api) return;

  const phase = api.values.shutter;
  if (isShutterAnimating(phase)) return;
  if (phase !== "intro" && phase !== "closed") return;

  api.setVariable("shutter", "opening");
  playActiveSkinSound("open");
}

export function playShutterClose(): void {
  const api = getSkinViewStateApi();
  if (!api) return;

  const phase = api.values.shutter;
  if (isShutterAnimating(phase)) return;
  if (phase !== "open") return;

  api.setVariable("shutter", "closing");
  playActiveSkinSound("close");
}

export function toggleShutter(): void {
  const phase = getSkinViewStateApi()?.values.shutter;
  if (phase === "intro" || phase === "closed") {
    playShutterOpen();
  } else if (phase === "open") {
    playShutterClose();
  }
}

let introTimer: ReturnType<typeof setTimeout> | undefined;

export function scheduleShutterIntro(): void {
  clearTimeout(introTimer);
  introTimer = setTimeout(() => {
    introTimer = undefined;
    const phase = getSkinViewStateApi()?.values.shutter;
    if (phase === "intro") {
      playShutterOpen();
    }
  }, SHUTTER_INTRO_DELAY_MS);
}

export function cancelShutterIntro(): void {
  clearTimeout(introTimer);
  introTimer = undefined;
}
