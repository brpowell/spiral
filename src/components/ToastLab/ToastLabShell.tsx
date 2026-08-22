import { useCallback, useState } from "react";
import { BackgroundTasksStack } from "../BackgroundTasks/BackgroundTasksIndicator";
import { Button } from "../common/Button/Button";
import { FormField } from "../common/Field/Field";
import { TextInput } from "../common/TextInput/TextInput";
import { BackgroundTaskCancelledError } from "../../lib/backgroundTaskCancel";
import { joinPeerOutcomeClauses } from "../../lib/toastPeerOutcomes";
import { t } from "../../lib/i18n";
import {
  playbackFileMissingPayload,
  playlistAddedPayload,
  queueAddedPayload,
} from "../../lib/toastPayloads";
import { useBackgroundTasksStore } from "../../store/useBackgroundTasksStore";
import {
  toastLabScenarioFireCtx,
  toastLabScenarioGroups,
  toastLabUpdateAvailableActions,
  type ToastLabFireContext,
} from "./toastLabScenarios";
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

const SCENARIO_GROUPS = toastLabScenarioGroups();

export function ToastLabShell() {
  const showToast = useBackgroundTasksStore((s) => s.showToast);
  const showErrorToast = useBackgroundTasksStore((s) => s.showErrorToast);
  const runInBackground = useBackgroundTasksStore((s) => s.runInBackground);
  const dismissTask = useBackgroundTasksStore((s) => s.dismissTask);
  const tasks = useBackgroundTasksStore((s) => s.tasks);
  const [dismissMsRaw, setDismissMsRaw] = useState("null");

  const dismissMs = parseDismissMs(dismissMsRaw);

  const fireCtx: ToastLabFireContext = {
    showToast,
    showErrorToast,
    runInBackground,
    dismissMs,
    sleep,
  };

  const dismissAll = useCallback(() => {
    for (const task of useBackgroundTasksStore.getState().tasks) {
      dismissTask(task.id);
    }
  }, [dismissTask]);

  const fireSuccess = () => {
    const payload = queueAddedPayload([{ title: "Example Track Title" }], {
      dismissMs,
    });
    if (payload) {
      showToast({
        ...payload,
        key: `lab-success-${crypto.randomUUID().slice(0, 8)}`,
        status: "success",
      });
    }
  };

  const fireError = () => {
    showErrorToast({
      key: `lab-error-${crypto.randomUUID().slice(0, 8)}`,
      label: t("common:updates.error.check"),
      detail: "network offline (simulated)",
      dismissMs,
    });
  };

  const fireCancelled = () => {
    showToast({
      key: `lab-cancelled-${crypto.randomUUID().slice(0, 8)}`,
      label: t("toasts:lab.cancelled"),
      status: "cancelled",
      dismissMs,
    });
  };

  const fireWarning = () => {
    showToast({
      key: `lab-warning-${crypto.randomUUID().slice(0, 8)}`,
      label: joinPeerOutcomeClauses([
        t("toasts:trackMetadata.updated", { count: 2 }),
        t("toasts:trackMetadata.failed", { count: 1 }),
      ]),
      detail: "Track: Permission denied",
      status: "warning",
      dismissMs,
    });
  };

  const fireLabelOnly = () => {
    showToast({
      key: `lab-label-only-${crypto.randomUUID().slice(0, 8)}`,
      label: t("common:updates.upToDate"),
      status: "success",
      dismissMs,
    });
  };

  const fireInfo = () => {
    showToast({
      key: `lab-info-${crypto.randomUUID().slice(0, 8)}`,
      label: t("common:updates.available.label"),
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
      actions: toastLabUpdateAvailableActions(),
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
    const sticky = dismissMs ?? null;
    const queue = queueAddedPayload([{ title: "Track One" }], {
      dismissMs: sticky,
    });
    if (queue) {
      showToast({
        ...queue,
        key: `lab-stack-a-${stamp}`,
        status: "success",
      });
    }
    const playlist = playlistAddedPayload(
      [{ title: "Track Two" }],
      "Favorites",
      {
        dismissMs: sticky,
      },
    );
    if (playlist) {
      showToast({
        ...playlist,
        key: `lab-stack-b-${stamp}`,
        status: "success",
      });
    }
    showErrorToast({
      ...playbackFileMissingPayload(
        { title: "Track Three" },
        {
          dismissMs: sticky,
        },
      ),
      key: `lab-stack-c-${stamp}`,
    });
  };

  const fireGallery = () => {
    dismissAll();
    const sticky = dismissMs === undefined ? null : dismissMs;
    showToast({
      key: "lab-gallery-success",
      label: t("common:updates.upToDate"),
      status: "success",
      dismissMs: sticky,
    });
    showErrorToast({
      key: "lab-gallery-error",
      label: t("common:updates.error.install"),
      detail: "Signature verification failed",
      dismissMs: sticky,
    });
    showToast({
      key: "lab-gallery-warning",
      label: joinPeerOutcomeClauses([
        t("toasts:trackMetadata.updated", { count: 2 }),
        t("toasts:trackMetadata.failed", { count: 1 }),
      ]),
      detail: "Track: Permission denied",
      status: "warning",
      dismissMs: sticky,
    });
    showToast({
      key: "lab-gallery-info",
      label: t("common:updates.available.label"),
      detail: t("common:updates.available.detail", { version: "0.9.9" }),
      status: "info",
      dismissMs: sticky,
      actions: toastLabUpdateAvailableActions(),
    });
    showToast({
      key: "lab-gallery-cancelled",
      label: t("toasts:lab.cancelled"),
      status: "cancelled",
      dismissMs: sticky,
    });
    runInBackground({
      key: "lab-gallery-running",
      label: t("common:updates.downloading"),
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
                new BackgroundTaskCancelledError(
                  t("toasts:lab.downloadCancelled"),
                  {
                    dismissMs,
                  },
                ),
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
      label: t("common:updates.downloading"),
      cancellable: true,
      progressDisplay: "bar",
      run: async (ctx) => {
        const total = 20;
        for (let i = 1; i <= total; i++) {
          if (ctx.isCancelRequested()) {
            throw new BackgroundTaskCancelledError(
              t("toasts:lab.downloadCancelled"),
              {
                dismissMs,
              },
            );
          }
          ctx.setProgress(i, total);
          await sleep(120);
        }
        ctx.settleAs({
          status: "success",
          label: t("toasts:lab.updateReady"),
          dismissMs,
        });
      },
    });
  };

  const fireCancellable = () => {
    runInBackground({
      key: LAB_CANCEL_KEY,
      label: t("toasts:import.importing", { count: 40 }),
      cancellable: true,
      run: async (ctx) => {
        const total = 40;
        for (let i = 1; i <= total; i++) {
          if (ctx.isCancelRequested()) {
            throw new BackgroundTaskCancelledError(
              t("toasts:import.cancelled"),
              {
                dismissMs,
              },
            );
          }
          ctx.setLabel(
            `${t("toasts:import.importing", { count: total })} (${i}/${total})`,
          );
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
          actions: toastLabUpdateAvailableActions(),
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
      actions: toastLabUpdateAvailableActions(),
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
            <Button size="sm" onClick={fireWarning}>
              Warning
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

        <div className="toast-lab__production">
          <header className="toast-lab__production-header">
            <h2 className="toast-lab__section-title">Production scenarios</h2>
            <p className="toast-lab__hint">
              Presets mirroring real toast copy (i18n keys). Source noted on
              hover. Each scenario keeps its own key so variants can stack side
              by side.
            </p>
          </header>
          {SCENARIO_GROUPS.map(({ group, scenarios }) => (
            <section key={group} className="toast-lab__section">
              <h3 className="toast-lab__group-title">{group}</h3>
              <div className="toast-lab__row toast-lab__row--dense">
                {scenarios.map((scenario) => (
                  <Button
                    key={scenario.id}
                    size="sm"
                    title={`${scenario.source} · ${scenario.id}`}
                    onClick={() => {
                      void scenario.fire(
                        toastLabScenarioFireCtx(fireCtx, scenario.id),
                      );
                    }}
                  >
                    {scenario.buttonLabel}
                  </Button>
                ))}
              </div>
            </section>
          ))}
        </div>
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
