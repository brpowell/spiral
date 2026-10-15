/**
 * One-shot UI sounds (skin clicks, transport cues).
 *
 * Clips are fetched once, handed to the Rust mixer, and played from there, so
 * they share the music's native output and survive sleep/wake with it. Clips
 * are short WAV files; Rust decodes them.
 */
import { invoke } from "@tauri-apps/api/core";

let nextId = 1;
const ids = new Map<string, number>();
const loaded = new Set<number>();
const inflight = new Map<string, Promise<number | null>>();
/** Bumped on each play so a late load cannot start over a newer request. */
const playGeneration = new Map<string, number>();

function idFor(url: string): number {
  let id = ids.get(url);
  if (id === undefined) {
    id = nextId++;
    ids.set(url, id);
  }
  return id;
}

function start(id: number): void {
  void invoke("play_sfx", { id }).catch((err) => {
    console.error("Failed to play sound:", err);
  });
}

function ensureLoaded(url: string): Promise<number | null> {
  const id = idFor(url);
  if (loaded.has(id)) return Promise.resolve(id);

  const pending = inflight.get(url);
  if (pending) return pending;

  const load = (async (): Promise<number | null> => {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      await invoke("load_sfx", bytes, {
        headers: { "x-sfx-id": String(id) },
      });
      loaded.add(id);
      return id;
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
  const generation = (playGeneration.get(url) ?? 0) + 1;
  playGeneration.set(url, generation);

  const id = ids.get(url);
  if (id !== undefined && loaded.has(id)) {
    start(id);
    return;
  }

  void ensureLoaded(url).then((loadedId) => {
    if (loadedId === null || playGeneration.get(url) !== generation) return;
    start(loadedId);
  });
}
