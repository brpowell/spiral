/**
 * One-shot UI sounds (skin clicks, transport cues).
 *
 * Own AudioContext, separate from the PCM music graph. That graph is rebuilt
 * on WebKit sleep, and UI clicks must not ride the EQ or mixer. Clips are
 * short WAV files; `decodeAudioData` handles those without a codec plugin.
 */

const buffers = new Map<string, AudioBuffer>();
const inflight = new Map<string, Promise<AudioBuffer | null>>();
const active = new Map<string, AudioBufferSourceNode>();
/** Bumped on each play so a late decode cannot start over a newer request. */
const playGeneration = new Map<string, number>();

let context: AudioContext | null = null;

function audioContext(): AudioContext {
  if (!context || context.state === "closed") {
    context = new AudioContext();
  }
  return context;
}

function stopActive(url: string): void {
  const previous = active.get(url);
  if (!previous) return;
  previous.onended = null;
  try {
    previous.stop();
  } catch {
    // Already stopped or never started.
  }
  previous.disconnect();
  active.delete(url);
}

function start(url: string, buffer: AudioBuffer): void {
  const ctx = audioContext();
  void ctx.resume();
  stopActive(url);

  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.onended = () => {
    if (active.get(url) === source) active.delete(url);
  };
  source.start(0);
  active.set(url, source);
}

async function loadBuffer(url: string): Promise<AudioBuffer | null> {
  const cached = buffers.get(url);
  if (cached) return cached;

  const pending = inflight.get(url);
  if (pending) return pending;

  const load = (async (): Promise<AudioBuffer | null> => {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const bytes = await response.arrayBuffer();
      const decoded = await audioContext().decodeAudioData(bytes.slice(0));
      buffers.set(url, decoded);
      return decoded;
    } catch (err) {
      console.error("Failed to load sound:", url, err);
      return null;
    } finally {
      inflight.delete(url);
    }
  })();

  inflight.set(url, load);
  return load;
}

/** Restart `url` from the beginning. Later plays of the same URL cut the previous one. */
export function playOneShot(url: string): void {
  const ctx = audioContext();
  void ctx.resume();
  const generation = (playGeneration.get(url) ?? 0) + 1;
  playGeneration.set(url, generation);

  const cached = buffers.get(url);
  if (cached) {
    start(url, cached);
    return;
  }

  void loadBuffer(url).then((buffer) => {
    if (!buffer || playGeneration.get(url) !== generation) return;
    start(url, buffer);
  });
}
