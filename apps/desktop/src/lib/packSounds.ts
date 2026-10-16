import { convertFileSrc } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { resolveSoundCue, resolveSoundPackAsset } from "./tauri";
import { isTauri } from "./windowRole";

/** Fired after the active sound pack changes so every window drops its resolved cues. */
export const SOUND_PACK_CHANGED_EVENT = "sound-pack://changed";

const urlCache = new Map<string, string | null>();
const inflight = new Map<string, Promise<string | null>>();

/** Drop resolved cue URLs (active pack changed, or packs were installed/removed). */
export function invalidateSoundCueCache(): void {
  urlCache.clear();
  inflight.clear();
}

/** Tell every window (this one included) that the active sound pack changed. */
export async function broadcastSoundPackChanged(): Promise<void> {
  invalidateSoundCueCache();
  if (!isTauri()) return;
  try {
    await emit(SOUND_PACK_CHANGED_EVENT);
  } catch {
    /* ignore cross-window emit failures */
  }
}

let listening = false;

function listenForSoundPackChanges(): void {
  if (listening || !isTauri()) return;
  listening = true;
  void listen(SOUND_PACK_CHANGED_EVENT, invalidateSoundCueCache).catch(() => {
    listening = false;
  });
}

/**
 * Asset protocol URL for a cue from the active sound pack (default pack as
 * fallback), or null when neither defines it.
 */
export async function resolveCueUrl(cue: string): Promise<string | null> {
  const trimmed = cue.trim();
  if (!trimmed) return null;
  listenForSoundPackChanges();

  if (urlCache.has(trimmed)) return urlCache.get(trimmed) ?? null;
  const pending = inflight.get(trimmed);
  if (pending) return pending;

  const load = resolveSoundCue(trimmed)
    .then((path) => {
      const url = path ? convertFileSrc(path) : null;
      // A pack change mid-flight clears `inflight`; don't cache a stale answer.
      if (inflight.get(trimmed) === load) urlCache.set(trimmed, url);
      return url;
    })
    .catch((err: unknown) => {
      console.error("Failed to resolve sound cue:", trimmed, err);
      return null;
    })
    .finally(() => {
      if (inflight.get(trimmed) === load) inflight.delete(trimmed);
    });

  inflight.set(trimmed, load);
  return load;
}

/** Asset protocol URL for one sound in a specific pack (previews), or null. */
export async function resolveSoundPackAssetUrl(
  soundPackId: string,
  soundId: string,
): Promise<string | null> {
  try {
    const path = await resolveSoundPackAsset(soundPackId, soundId);
    return path ? convertFileSrc(path) : null;
  } catch (err) {
    console.error("Failed to resolve sound:", soundPackId, soundId, err);
    return null;
  }
}
