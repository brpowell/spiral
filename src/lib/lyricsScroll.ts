import type { LyricsLine } from "../types/lyrics";

export function hasSyncedTimestamps(lines: LyricsLine[]): boolean {
  return lines.some((line) => line.startMs !== undefined);
}

function findFirstSyncedLineIndex(lines: LyricsLine[]): number {
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startMs !== undefined) return i;
  }
  return -1;
}

interface LyricsPrerollState {
  firstLineIndex: number;
  progress: number;
}

const PREROLL_MIN_LEAD_MS = 2_000;

export function getLyricsPrerollState(
  positionMs: number,
  lines: LyricsLine[],
): LyricsPrerollState | null {
  const firstLineIndex = findFirstSyncedLineIndex(lines);
  if (firstLineIndex < 0) return null;

  const firstLineStartMs = lines[firstLineIndex].startMs;
  if (firstLineStartMs === undefined || firstLineStartMs <= 0) return null;
  if (firstLineStartMs <= PREROLL_MIN_LEAD_MS) return null;
  if (positionMs >= firstLineStartMs) return null;

  return {
    firstLineIndex,
    progress: Math.max(0, Math.min(1, positionMs / firstLineStartMs)),
  };
}

function getLineEndMs(lines: LyricsLine[], index: number): number | undefined {
  const line = lines[index];
  if (line.endMs !== undefined) {
    return line.endMs;
  }

  for (let i = index + 1; i < lines.length; i++) {
    const nextStartMs = lines[i].startMs;
    if (nextStartMs !== undefined) {
      return nextStartMs;
    }
  }

  return undefined;
}

/** Line currently being sung at `positionMs`, or -1 during gaps. */
export function findSingingLineIndex(
  positionMs: number,
  lines: LyricsLine[],
): number {
  for (let i = 0; i < lines.length; i++) {
    const startMs = lines[i].startMs;
    if (startMs === undefined) continue;
    if (startMs > positionMs) break;

    const endMs = getLineEndMs(lines, i);
    if (endMs === undefined || positionMs < endMs) {
      return i;
    }
  }

  return -1;
}

function findUpcomingSyncedLineIndex(
  positionMs: number,
  lines: LyricsLine[],
): number {
  let upcomingIndex = -1;
  let upcomingStartMs = Infinity;

  for (let i = 0; i < lines.length; i++) {
    const startMs = lines[i].startMs;
    if (startMs === undefined || startMs <= positionMs) continue;

    if (startMs < upcomingStartMs) {
      upcomingStartMs = startMs;
      upcomingIndex = i;
    }
  }

  return upcomingIndex;
}

function findClosestSyncedLineIndex(
  positionMs: number,
  lines: LyricsLine[],
): number {
  let closestIndex = -1;
  let closestDistance = Infinity;

  for (let i = 0; i < lines.length; i++) {
    const startMs = lines[i].startMs;
    if (startMs === undefined) continue;

    const distance = Math.abs(startMs - positionMs);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestIndex = i;
    }
  }

  return closestIndex;
}

export function findScrollLineIndex(
  positionMs: number,
  lines: LyricsLine[],
): number {
  const singingIndex = findSingingLineIndex(positionMs, lines);
  if (singingIndex >= 0) return singingIndex;

  const upcomingIndex = findUpcomingSyncedLineIndex(positionMs, lines);
  if (upcomingIndex >= 0) return upcomingIndex;

  return findClosestSyncedLineIndex(positionMs, lines);
}

function easeInOutSine(t: number): number {
  return (1 - Math.cos(t * Math.PI)) / 2;
}

function getLineScrollTarget(
  container: HTMLElement,
  lineEl: HTMLElement,
): number {
  const lineTop = lineEl.offsetTop;
  const lineHeight = lineEl.offsetHeight;
  const containerHeight = container.clientHeight;
  const targetScrollTop = lineTop - containerHeight / 2 + lineHeight / 2;
  const maxScroll = container.scrollHeight - containerHeight;
  return Math.max(0, Math.min(maxScroll, targetScrollTop));
}

function getScrollDuration(distance: number): number {
  return Math.min(650, Math.max(310, Math.abs(distance) * 0.9));
}

export function scrollLineIntoView(
  container: HTMLElement,
  lineEl: HTMLElement,
  options: { reduceMotion?: boolean; instant?: boolean } = {},
): () => void {
  const target = getLineScrollTarget(container, lineEl);

  if (options.reduceMotion || options.instant) {
    container.scrollTop = target;
    return () => {};
  }

  const start = container.scrollTop;
  const distance = target - start;

  if (Math.abs(distance) < 1) {
    return () => {};
  }

  const duration = getScrollDuration(distance);
  let startTime: number | null = null;
  let frameId = 0;

  const step = (timestamp: number) => {
    if (startTime === null) startTime = timestamp;
    const elapsed = timestamp - startTime;
    const progress = Math.min(1, elapsed / duration);
    const eased = easeInOutSine(progress);
    container.scrollTop = start + distance * eased;

    if (progress < 1) {
      frameId = requestAnimationFrame(step);
      return;
    }

    container.scrollTop = target;
  };

  frameId = requestAnimationFrame(step);

  return () => {
    cancelAnimationFrame(frameId);
  };
}
