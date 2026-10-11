import { t } from "./i18n";

export class BackgroundTaskCancelledError extends Error {
  readonly toastLabel: string;
  /**
   * Auto-dismiss delay for the cancelled toast. `null` keeps it until dismissed.
   * When omitted, the store uses its default cancelled dismiss delay.
   */
  readonly dismissMs?: number | null;

  constructor(
    toastLabel = t("toasts:cancelled"),
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
