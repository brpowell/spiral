import type { RepeatMode } from "@/types/track";

export function getAutoplayNextId(
  queue: number[],
  currentId: number,
  mode: RepeatMode,
): number | null {
  if (queue.length === 0) return null;
  const idx = queue.indexOf(currentId);
  if (idx < 0) return queue[0] ?? null;
  if (mode === "one") return currentId;
  if (idx < queue.length - 1) return queue[idx + 1] ?? null;
  if (mode === "all") return queue[0] ?? null;
  return null;
}

export function getManualNextId(
  queue: number[],
  currentId: number,
  mode: RepeatMode,
): number | null {
  if (queue.length === 0) return null;
  const idx = queue.indexOf(currentId);
  if (idx < 0) return queue[0] ?? null;
  if (idx < queue.length - 1) return queue[idx + 1] ?? null;
  if (mode === "all") return queue[0] ?? null;
  return null;
}

export function getManualPreviousId(
  queue: number[],
  currentId: number,
  mode: RepeatMode,
): number | null {
  if (queue.length === 0) return null;
  const idx = queue.indexOf(currentId);
  if (idx < 0) return queue[queue.length - 1] ?? null;
  if (idx > 0) return queue[idx - 1] ?? null;
  if (mode === "all") return queue[queue.length - 1] ?? null;
  return null;
}

export function cycleRepeatMode(mode: RepeatMode): RepeatMode {
  if (mode === "off") return "all";
  if (mode === "all") return "one";
  return "off";
}

/** Toggle playlist repeat on/off (no repeat-one). */
export function toggleRepeatMode(mode: RepeatMode): RepeatMode {
  return mode === "off" ? "all" : "off";
}

function fisherYates<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/** Shuffle upcoming tracks; current track and already-played tracks keep their order. */
export function shuffleTrackList(
  ids: number[],
  currentId: number | null,
): number[] {
  if (ids.length <= 1) return [...ids];
  if (currentId === null) return fisherYates(ids);

  const idx = ids.indexOf(currentId);
  if (idx < 0) return fisherYates(ids);

  const played = ids.slice(0, idx + 1);
  const upcoming = fisherYates(ids.slice(idx + 1));
  return [...played, ...upcoming];
}

/** Shuffle a new list while keeping the starting track first. */
export function shuffleNewTrackList(ids: number[], startId: number): number[] {
  if (ids.length <= 1) return [...ids];
  const rest = ids.filter((id) => id !== startId);
  return [startId, ...fisherYates(rest)];
}

/**
 * Sequential order to go back to when shuffle is switched off. Only applies
 * when the remembered order covers exactly the tracks in the current set list;
 * otherwise (the list was edited or replaced since) returns null and the
 * caller keeps the current order.
 */
export function restoreSequentialOrder(
  current: number[],
  sequential: number[] | null,
): number[] | null {
  if (!sequential || sequential.length !== current.length) return null;
  const currentSet = new Set(current);
  if (currentSet.size !== current.length) return null;
  if (!sequential.every((id) => currentSet.has(id))) return null;
  return [...sequential];
}
