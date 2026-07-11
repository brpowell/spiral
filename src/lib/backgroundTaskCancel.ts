export class BackgroundTaskCancelledError extends Error {
  readonly toastLabel: string;

  constructor(toastLabel = "Cancelled") {
    super("cancelled");
    this.name = "BackgroundTaskCancelledError";
    this.toastLabel = toastLabel;
  }
}

export function isBackgroundTaskCancelledError(
  err: unknown,
): err is BackgroundTaskCancelledError {
  return err instanceof BackgroundTaskCancelledError;
}
