/**
 * Dev-only: keep the User Timing buffer from growing without bound.
 *
 * React DOM's development build records a `performance.measure()` for every
 * component render (the "Components ⚛" performance track), with a serialized
 * `detail` holding the prop diff. The User Timing spec puts no cap on that
 * buffer, so under a 60 fps re-render (visualizer, scrolling text) WebKit
 * retains hundreds of measures per second — ~1 MB/s of heap that GC cannot
 * free. Production builds never emit these measures.
 *
 * Entries are dropped once the buffer passes a threshold; nothing in the app
 * reads them back.
 */
const MAX_BUFFERED_ENTRIES = 2_000;

export function installDevUserTimingGuard(): void {
  if (!import.meta.env.DEV) return;
  if (typeof PerformanceObserver === "undefined") return;

  const observer = new PerformanceObserver(() => {
    if (performance.getEntriesByType("measure").length > MAX_BUFFERED_ENTRIES) {
      performance.clearMeasures();
      performance.clearMarks();
    }
  });
  observer.observe({ entryTypes: ["measure"] });
}
