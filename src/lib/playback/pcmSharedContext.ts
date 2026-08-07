/** Shared AudioContext for library-file PCM decks (crossfade needs one graph). */

import pcmStreamProcessorUrl from "./pcmStreamProcessor.ts?worker&url";

let sharedContext: AudioContext | null = null;
let sharedWorkletModule: Promise<void> | null = null;

export function getSharedPcmAudioContext(): AudioContext {
  if (!sharedContext || sharedContext.state === "closed") {
    sharedContext = new AudioContext();
    sharedWorkletModule = null;
  }
  return sharedContext;
}

export async function ensureSharedPcmWorkletModule(
  ctx: AudioContext,
): Promise<void> {
  sharedWorkletModule ??= ctx.audioWorklet.addModule(pcmStreamProcessorUrl);
  await sharedWorkletModule;
}
