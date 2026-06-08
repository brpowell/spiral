type SchedulerWithYield = { yield: () => Promise<void> };

const SCROLL_QUIET_MS = 80;
const SCROLL_DEFER_MAX_MS = 300;

let lastScrollAt = 0;

if (typeof document !== "undefined") {
  document.addEventListener(
    "scroll",
    () => {
      lastScrollAt = Date.now();
    },
    { capture: true, passive: true },
  );
}

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

export function isUserScrolling(): boolean {
  return Date.now() - lastScrollAt < SCROLL_QUIET_MS;
}

export async function waitForScrollQuiet(): Promise<void> {
  if (Date.now() - lastScrollAt >= SCROLL_QUIET_MS) return;

  await new Promise<void>((resolve) => {
    const started = Date.now();
    const tick = () => {
      const quiet = Date.now() - lastScrollAt >= SCROLL_QUIET_MS;
      const timedOut = Date.now() - started >= SCROLL_DEFER_MAX_MS;
      if (quiet || timedOut) {
        resolve();
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/**
 * Yield through a paint and back off briefly while the user is scrolling.
 * Use between import chunks so IPC work does not compete with scroll frames.
 */
export async function yieldForInteraction(): Promise<void> {
  await waitForPaint();
  await yieldToMain();
  await waitForScrollQuiet();
  if (lastScrollAt > 0) {
    await waitForPaint();
  }
}
