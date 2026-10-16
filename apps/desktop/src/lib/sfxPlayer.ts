/**
 * One-shot UI sounds (skin clicks, transport cues).
 *
 * Clips are fetched once, handed to the Rust mixer, and played from there, so
 * they share the music's native output and survive sleep/wake with it. Clips
 * are short WAV files; Rust decodes them.
 */
import { invoke } from "@tauri-apps/api/core";

/**
 * Rust keeps one clip table for every window, so a clip is addressed by its URL
 * rather than a per-window counter. Each window numbering its clips from 1 let
 * one window's sound replace another's.
 */
const loaded = new Set<string>();
const inflight = new Map<string, Promise<string | null>>();
/** Bumped on each play so a late load cannot start over a newer request. */
const playGeneration = new Map<string, number>();

/** Header-safe form of the URL, used as the clip's key in Rust. */
function keyFor(url: string): string {
  return encodeURIComponent(url);
}

function start(key: string): void {
  void invoke("play_sfx", { key }).catch((err) => {
    console.error("Failed to play sound:", err);
  });
}

function ensureLoaded(url: string): Promise<string | null> {
  const key = keyFor(url);
  if (loaded.has(key)) return Promise.resolve(key);

  const pending = inflight.get(url);
  if (pending) return pending;

  const load = (async (): Promise<string | null> => {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      await invoke("load_sfx", bytes, {
        headers: { "x-sfx-key": key },
      });
      loaded.add(key);
      return key;
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

  const key = keyFor(url);
  if (loaded.has(key)) {
    start(key);
    return;
  }

  void ensureLoaded(url).then((loadedKey) => {
    if (loadedKey === null || playGeneration.get(url) !== generation) return;
    start(loadedKey);
  });
}
