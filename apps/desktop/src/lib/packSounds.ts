import { convertFileSrc } from "@tauri-apps/api/core";
import { resolveSoundAsset } from "./tauri";

/** Core transport cues shipped as built-in sound items. */
export const CORE_TRANSPORT_PLAY_SOUND_ID = "spiral.sound.play";
export const CORE_TRANSPORT_CONTROL_SOUND_ID = "spiral.sound.control";

const pathCache = new Map<string, string | null>();
const inflight = new Map<string, Promise<string | null>>();

/**
 * Sound item ids look like `authorId.sound.id`.
 * Anything else is treated as a skin-local `soundEffects` key.
 */
export function isPublicSoundContributionId(id: string): boolean {
  const parts = id.split(".");
  return (
    parts.length === 3 &&
    parts[1] === "sound" &&
    parts.every((part) => part.length > 0)
  );
}

/** Absolute filesystem path for an installed sound contribution, or null. */
export async function resolveSoundAssetPath(
  soundId: string,
): Promise<string | null> {
  const trimmed = soundId.trim();
  if (!trimmed || !isPublicSoundContributionId(trimmed)) return null;

  if (pathCache.has(trimmed)) {
    return pathCache.get(trimmed) ?? null;
  }

  const pending = inflight.get(trimmed);
  if (pending) return pending;

  const load = resolveSoundAsset(trimmed)
    .then((path) => {
      pathCache.set(trimmed, path);
      return path;
    })
    .catch((err: unknown) => {
      console.error("Failed to resolve sound contribution:", trimmed, err);
      pathCache.set(trimmed, null);
      return null;
    })
    .finally(() => {
      inflight.delete(trimmed);
    });

  inflight.set(trimmed, load);
  return load;
}

/** Asset protocol URL for an installed sound contribution, or null. */
export async function resolveSoundAssetUrl(
  soundId: string,
): Promise<string | null> {
  const path = await resolveSoundAssetPath(soundId);
  if (!path) return null;
  return convertFileSrc(path);
}
