import type { Track } from "../types/track";
import { isUserScrolling, waitForPaint, waitForScrollQuiet } from "./scheduling";
import { usePlayerStore } from "../store/usePlayerStore";

interface QueuedActivation {
  pendingId: number;
  track: Track;
}

const MAX_SCROLL_DEFER_MS = 450;
const MIN_BATCH_INTERVAL_MS = 120;

const activationQueue: QueuedActivation[] = [];
const removalQueue: number[] = [];

let flushScheduled = false;
let queueEpoch = 0;
let lastFlushAt = 0;

function scheduleFlush(): void {
  if (flushScheduled) return;
  flushScheduled = true;
  queueMicrotask(() => {
    flushScheduled = false;
    void flushWhenReady();
  });
}

async function flushWhenReady(): Promise<void> {
  if (activationQueue.length === 0 && removalQueue.length === 0) return;

  const epoch = queueEpoch;
  const queuedAt = Date.now();
  const minBatchWait = Math.max(0, MIN_BATCH_INTERVAL_MS - (queuedAt - lastFlushAt));

  if (minBatchWait > 0) {
    await new Promise<void>((resolve) => {
      globalThis.setTimeout(resolve, minBatchWait);
    });
  }

  if (epoch !== queueEpoch) return;

  if (isUserScrolling()) {
    const scrolledTooLong = Date.now() - queuedAt >= MAX_SCROLL_DEFER_MS;
    if (!scrolledTooLong) {
      await waitForScrollQuiet();
      if (epoch !== queueEpoch) return;
    }
  }

  await waitForPaint();
  if (epoch !== queueEpoch) return;

  flushNow();

  if (activationQueue.length > 0 || removalQueue.length > 0) {
    scheduleFlush();
  }
}

function flushNow(): void {
  if (activationQueue.length === 0 && removalQueue.length === 0) return;

  const activations = activationQueue.splice(0);
  const removals = removalQueue.splice(0);
  lastFlushAt = Date.now();

  usePlayerStore.getState().applyImportTrackUpdates(activations, removals);
}

export function resetImportActivationQueue(): void {
  queueEpoch += 1;
  activationQueue.length = 0;
  removalQueue.length = 0;
  flushScheduled = false;
}

export function queueImportedTrackActivation(
  pendingId: number,
  track: Track,
): void {
  activationQueue.push({ pendingId, track });
  scheduleFlush();
}

export function queuePendingImportRemoval(pendingId: number): void {
  removalQueue.push(pendingId);
  scheduleFlush();
}

/** Apply any queued import row updates immediately (e.g. at end of import). */
export function flushImportActivationQueue(): void {
  queueEpoch += 1;
  flushNow();
}
