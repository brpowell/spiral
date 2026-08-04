import { useCallback, useState } from "react";
import { BackgroundTasksStack } from "../BackgroundTasks/BackgroundTasksIndicator";
import { Button } from "../common/Button/Button";
import { FormField } from "../common/Field/Field";
import { TextInput } from "../common/TextInput/TextInput";
import { BackgroundTaskCancelledError } from "../../lib/backgroundTaskCancel";
import { t } from "../../lib/i18n";
import { useBackgroundTasksStore } from "../../store/useBackgroundTasksStore";
import "./ToastLabShell.css";

const LAB_MERGE_KEY = "lab-merge";
const LAB_REPLACE_KEY = "lab-replace";
const LAB_PROGRESS_KEY = "lab-progress";
const LAB_CANCEL_KEY = "lab-cancel";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function parseDismissMs(raw: string): number | null | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  if (trimmed.toLowerCase() === "null" || trimmed === "-") return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.floor(n);
}

function updateAvailableActions() {
  return [
    {
      id: "update",
      label: t("common:updates.available.update"),
      variant: "primary" as const,
      onClick: () => {
        /* Lab preview — no install. */
      },
    },
    {
      id: "later",
      label: t("common:updates.available.later"),
      variant: "ghost" as const,
      onClick: () => {
        /* Lab preview. */
      },
    },
  ];
}

export function ToastLabShell() {
  const showToast = useBackgroundTasksStore((s) => s.showToast);
  const showErrorToast = useBackgroundTasksStore((s) => s.showErrorToast);
  const runInBackground = useBackgroundTasksStore((s) => s.runInBackground);
  const dismissTask = useBackgroundTasksStore((s) => s.dismissTask);
  const tasks = useBackgroundTasksStore((s) => s.tasks);
  const [dismissMsRaw, setDismissMsRaw] = useState("null");

  const dismissMs = parseDismissMs(dismissMsRaw);

  const dismissAll = useCallback(() => {
    for (const task of useBackgroundTasksStore.getState().tasks) {
      dismissTask(task.id);
    }
  }, [dismissTask]);

  const fireSuccess = () => {
    showToast({
      key: `lab-success-${crypto.randomUUID().slice(0, 8)}`,
      label: "Added to queue",
      detail: "Example Track Title",
      status: "success",
      dismissMs,
    });
  };

  const fireError = () => {
    showErrorToast({
      key: `lab-error-${crypto.randomUUID().slice(0, 8)}`,
      label: "Couldn't check for updates",
      detail: "network offline (simulated)",
      dismissMs,
    });
  };

  const fireCancelled = () => {
    showToast({
      key: `lab-cancelled-${crypto.randomUUID().slice(0, 8)}`,
      label: "Lab task cancelled",
      status: "cancelled",
      dismissMs,
    });
  };

  const fireLabelOnly = () => {
    showToast({
      key: `lab-label-only-${crypto.randomUUID().slice(0, 8)}`,
      label: "You're up to date",
      status: "success",
      dismissMs,
    });
  };

  const fireInfo = () => {
    showToast({
      key: `lab-info-${crypto.randomUUID().slice(0, 8)}`,
      label: "Update available",
      detail: t("common:updates.available.detail", { version: "0.9.9" }),
      status: "info",
      dismissMs,
    });
  };

  const fireUpdateActions = () => {
    showToast({
      key: "lab-update-actions",
      label: t("common:updates.available.label"),
      detail: t("common:updates.available.detail", { version: "0.9.9" }),
      status: "info",
      dismissMs: null,
      actions: updateAvailableActions(),
    });
  };

  const fireLongText = () => {
    showToast({
      key: `lab-long-${crypto.randomUUID().slice(0, 8)}`,
      label:
        "A very long toast label that should clamp after two lines so we can check overflow and wrapping behavior in the indicator",
      detail:
        "And an equally long detail line about something that went wrong while importing a deeply nested album path into the library",
      status: "error",
      dismissMs,
    });
  };

  const fireStack = () => {
    const stamp = crypto.randomUUID().slice(0, 6);
    showToast({
      key: `lab-stack-a-${stamp}`,
      label: "Added to queue",
      detail: "Track One",
      status: "success",
      dismissMs: dismissMs ?? null,
    });
    showToast({
      key: `lab-stack-b-${stamp}`,
      label: "Added to Favorites",
      detail: "Track Two",
      status: "success",
      dismissMs: dismissMs ?? null,
    });
    showErrorToast({
      key: `lab-stack-c-${stamp}`,
      label: "File not found",
      detail: "Track Three",
      dismissMs: dismissMs ?? null,
    });
  };

  const fireGallery = () => {
    dismissAll();
    const sticky = dismissMs === undefined ? null : dismissMs;
    showToast({
      key: "lab-gallery-success",
      label: "You're up to date",
      status: "success",
      dismissMs: sticky,
    });
    showErrorToast({
      key: "lab-gallery-error",
      label: "Couldn't install the update",
      detail: "Signature verification failed",
      dismissMs: sticky,
    });
    showToast({
      key: "lab-gallery-info",
      label: t("common:updates.available.label"),
      detail: t("common:updates.available.detail", { version: "0.9.9" }),
      status: "info",
      dismissMs: sticky,
      actions: updateAvailableActions(),
    });
    showToast({
      key: "lab-gallery-cancelled",
      label: "Lab task cancelled",
      status: "cancelled",
      dismissMs: sticky,
    });
    runInBackground({
      key: "lab-gallery-running",
      label: "Downloading update…",
      cancellable: true,
      progressDisplay: "bar",
      run: async (ctx) => {
        ctx.setProgress(42, 100);
        // Hold running until cancelled or dismissed via Dismiss all.
        await new Promise<void>((resolve, reject) => {
          const id = window.setInterval(() => {
            if (ctx.isCancelRequested()) {
              window.clearInterval(id);
              reject(
                new BackgroundTaskCancelledError("Download cancelled", {
                  dismissMs,
                }),
              );
              return;
            }
            const stillThere = useBackgroundTasksStore
              .getState()
              .tasks.some((task) => task.key === "lab-gallery-running");
            if (!stillThere) {
              window.clearInterval(id);
              resolve();
            }
          }, 200);
        });
      },
    });
  };

  const fireProgress = () => {
    runInBackground({
      key: LAB_PROGRESS_KEY,
      label: "Downloading update…",
      cancellable: true,
      progressDisplay: "bar",
      run: async (ctx) => {
        const total = 20;
        for (let i = 1; i <= total; i++) {
          if (ctx.isCancelRequested()) {
            throw new BackgroundTaskCancelledError("Download cancelled", {
              dismissMs,
            });
          }
          ctx.setProgress(i, total);
          await sleep(120);
        }
        ctx.settleAs({
          status: "success",
          label: "Update ready — restarting…",
          dismissMs,
        });
      },
    });
  };

  const fireCancellable = () => {
    runInBackground({
      key: LAB_CANCEL_KEY,
      label: "Importing files…",
      cancellable: true,
      run: async (ctx) => {
        const total = 40;
        for (let i = 1; i <= total; i++) {
          if (ctx.isCancelRequested()) {
            throw new BackgroundTaskCancelledError("Import cancelled", {
              dismissMs,
            });
          }
          ctx.setLabel(`Importing files… (${i}/${total})`);
          ctx.setProgress(i, total);
          await sleep(200);
        }
      },
    });
  };

  const fireSettleAsMerge = () => {
    runInBackground({
      key: LAB_MERGE_KEY,
      label: t("common:updates.checking"),
      run: async (ctx) => {
        await sleep(1400);
        ctx.settleAs({
          status: "info",
          label: t("common:updates.available.label"),
          detail: t("common:updates.available.detail", { version: "0.9.9" }),
          actions: updateAvailableActions(),
          dismissMs: null,
        });
      },
    });
  };

  const fireKeyReplaceMerge = async () => {
    showToast({
      key: LAB_REPLACE_KEY,
      label: t("common:updates.checking"),
      status: "info",
      dismissMs: null,
    });
    await sleep(1400);
    showToast({
      key: LAB_REPLACE_KEY,
      label: t("common:updates.available.label"),
      detail: t("common:updates.available.detail", { version: "0.9.9" }),
      status: "info",
      dismissMs: null,
      actions: updateAvailableActions(),
    });
  };

  return (
    <div className="toast-lab">
      <aside className="toast-lab__controls">
        <header className="toast-lab__header">
          <h1 className="toast-lab__title">Toast Lab</h1>
          <p className="toast-lab__subtitle">
            Drive the real background-task stack. CSS edits hot-reload here.
          </p>
        </header>

        <FormField
          label="Auto-dismiss (ms)"
          description={
            <>
              <code>null</code> / <code>-</code> sticky · empty = default ·
              number = ms
            </>
          }
        >
          <TextInput
            value={dismissMsRaw}
            onChange={(e) => setDismissMsRaw(e.target.value)}
            placeholder="null | empty | number"
            aria-label="Auto-dismiss milliseconds"
          />
        </FormField>

        <section className="toast-lab__section">
          <h2 className="toast-lab__section-title">Statuses</h2>
          <div className="toast-lab__row">
            <Button size="sm" onClick={fireSuccess}>
              Success
            </Button>
            <Button size="sm" onClick={fireError}>
              Error
            </Button>
            <Button size="sm" onClick={fireCancelled}>
              Cancelled
            </Button>
            <Button size="sm" onClick={fireLabelOnly}>
              Label only
            </Button>
            <Button size="sm" onClick={fireInfo}>
              Info
            </Button>
            <Button size="sm" variant="primary" onClick={fireUpdateActions}>
              Info + actions
            </Button>
            <Button size="sm" onClick={fireLongText}>
              Long text
            </Button>
          </div>
        </section>

        <section className="toast-lab__section">
          <h2 className="toast-lab__section-title">Running / progress</h2>
          <div className="toast-lab__row">
            <Button size="sm" onClick={fireProgress}>
              Progress → success
            </Button>
            <Button size="sm" onClick={fireCancellable}>
              Cancellable import
            </Button>
          </div>
        </section>

        <section className="toast-lab__section">
          <h2 className="toast-lab__section-title">Merging</h2>
          <p className="toast-lab__hint">
            <strong>settleAs</strong> patches the same task id (in-place).{" "}
            <strong>key replace</strong> removes + remounts (exit then enter).
          </p>
          <div className="toast-lab__row">
            <Button size="sm" onClick={fireSettleAsMerge}>
              Merge via settleAs
            </Button>
            <Button
              size="sm"
              onClick={() => {
                void fireKeyReplaceMerge();
              }}
            >
              Merge via key replace
            </Button>
          </div>
        </section>

        <section className="toast-lab__section">
          <h2 className="toast-lab__section-title">Layout</h2>
          <div className="toast-lab__row">
            <Button size="sm" onClick={fireStack}>
              Stack 3
            </Button>
            <Button size="sm" variant="primary" onClick={fireGallery}>
              Seed gallery
            </Button>
            <Button size="sm" variant="danger" onClick={dismissAll}>
              Dismiss all ({tasks.length})
            </Button>
          </div>
        </section>
      </aside>

      <div className="toast-lab__stage" aria-label="Toast stage">
        <div className="toast-lab__stage-chrome">
          <span className="toast-lab__stage-label">Stage</span>
          <span className="toast-lab__stage-meta">
            bottom-right stack · same CSS as the app
          </span>
        </div>
        <BackgroundTasksStack className="background-tasks toast-lab__stack" />
      </div>
    </div>
  );
}
