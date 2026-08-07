/**
 * Ignores stale remote position reports after an optimistic seek until the
 * backend catches up (or a timeout elapses).
 *
 * PCM/CD engines emit position every ~250ms from a decode thread. Seek is
 * async over a command channel, so events already in flight (or emitted before
 * seek lands) briefly report the pre-seek position and would bounce the UI.
 */
export class PositionSeekGuard {
  private pendingSeekSeconds: number | null = null;
  private pendingSeekAtMs = 0;

  constructor(
    private readonly confirmEpsilonSeconds = 1.5,
    private readonly timeoutMs = 2500,
  ) {}

  noteSeek(seconds: number): void {
    this.pendingSeekSeconds = seconds;
    this.pendingSeekAtMs = performance.now();
  }

  clear(): void {
    this.pendingSeekSeconds = null;
  }

  /** True when `reportedSeconds` should update the local playhead. */
  shouldAccept(reportedSeconds: number, nowMs = performance.now()): boolean {
    if (this.pendingSeekSeconds === null) return true;

    if (nowMs - this.pendingSeekAtMs > this.timeoutMs) {
      this.pendingSeekSeconds = null;
      return true;
    }

    if (
      Math.abs(reportedSeconds - this.pendingSeekSeconds) <=
      this.confirmEpsilonSeconds
    ) {
      this.pendingSeekSeconds = null;
      return true;
    }

    return false;
  }
}
