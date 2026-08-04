export class BackgroundTaskCancelledError extends Error {
  readonly toastLabel: string;
  /**
   * Auto-dismiss delay for the cancelled toast. `null` keeps it until dismissed.
   * When omitted, the store uses its default cancelled dismiss delay.
   */
  readonly dismissMs?: number | null;

  constructor(
    toastLabel = "Cancelled",
    options?: { dismissMs?: number | null },
  ) {
    super("cancelled");
    this.name = "BackgroundTaskCancelledError";
    this.toastLabel = toastLabel;
    this.dismissMs = options?.dismissMs;
  }
}

export function isBackgroundTaskCancelledError(
  err: unknown,
): err is BackgroundTaskCancelledError {
  return err instanceof BackgroundTaskCancelledError;
}
