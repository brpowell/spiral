type SchedulerWithYield = { yield: () => Promise<void> };

/** Wait for React to commit and the browser to paint before heavy work. */
export function waitForPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

/** Panel enter/exit duration in `lib/motion` — used to avoid racing animations with heavy work. */
const PANEL_TRANSITION_MS = 170;

/**
 * Yield until modal/toast motion can paint (after React commits `open={false}`).
 * Use before resuming IPC-heavy work that would block the main thread.
 */
export async function afterUiTransition(): Promise<void> {
  await waitForPaint();
  await yieldToMain();
  await new Promise<void>((resolve) => {
    setTimeout(resolve, PANEL_TRANSITION_MS);
  });
  await waitForPaint();
}

/** Yield so the browser can paint and handle input between heavy work chunks. */
export function yieldToMain(): Promise<void> {
  const sched = (globalThis as { scheduler?: SchedulerWithYield }).scheduler;
  if (sched?.yield) {
    return sched.yield();
  }
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}
