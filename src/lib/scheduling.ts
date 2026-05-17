type SchedulerWithYield = { yield: () => Promise<void> };

/** Wait for React to commit and the browser to paint before heavy work. */
export function waitForPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
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
