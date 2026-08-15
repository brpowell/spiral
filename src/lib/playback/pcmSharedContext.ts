/** Shared AudioContext for library-file PCM decks (crossfade needs one graph). */

import pcmStreamProcessorUrl from "./pcmStreamProcessor.ts?worker&url";

let sharedContext: AudioContext | null = null;
let sharedWorkletModule: Promise<void> | null = null;
/**
 * WebKit reports `running` after sleep even when the graph is dead (clock
 * frozen). Stay true until we close and replace the context.
 */
let needsRebuild = false;
let replacedContext: AudioContext | null = null;

export function getSharedPcmAudioContext(): AudioContext {
  if (!sharedContext || sharedContext.state === "closed") {
    sharedContext = new AudioContext();
    sharedWorkletModule = null;
    sharedContext.addEventListener("statechange", () => {
      if (sharedContext?.state === "interrupted") {
        needsRebuild = true;
      }
    });
  }
  return sharedContext;
}

export function sharedPcmContextNeedsRebuild(): boolean {
  return needsRebuild || sharedContext?.state === "interrupted";
}

/**
 * Replace the shared context on the calling stack so `resume()` can run inside
 * a user gesture. The previous context is kept alive until
 * `closeReplacedPcmAudioContext()` — closing it first can rip out WKWebView's
 * Core Audio device and leave the new graph running but silent.
 */
export function recreateSharedPcmAudioContextSync(): AudioContext {
  needsRebuild = false;
  if (replacedContext && replacedContext.state !== "closed") {
    void replacedContext.close();
  }
  replacedContext = sharedContext;
  sharedContext = null;
  sharedWorkletModule = null;
  return getSharedPcmAudioContext();
}

export function closeReplacedPcmAudioContext(): void {
  const previous = replacedContext;
  replacedContext = null;
  if (!previous || previous.state === "closed") return;
  void previous.close();
}

/** Prime destination output; some WebKit builds stay silent until a source starts. */
export function unlockAudioContext(ctx: AudioContext): void {
  const buffer = ctx.createBuffer(1, 1, ctx.sampleRate || 44100);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.start(0);
}

export async function ensureSharedPcmWorkletModule(
  ctx: AudioContext,
): Promise<void> {
  sharedWorkletModule ??= ctx.audioWorklet.addModule(pcmStreamProcessorUrl);
  await sharedWorkletModule;
}
