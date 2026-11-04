import { listen } from "@tauri-apps/api/event";
import type {
  BackgroundTaskRunContext,
  BackgroundTaskSettleAsOptions,
} from "../store/useBackgroundTasksStore";
import { useBackgroundTasksStore } from "../store/useBackgroundTasksStore";
import { usePlayerStore } from "../store/usePlayerStore";
import { useSourcesStore } from "../store/useSourcesStore";
import { ACTIVITY_LOG_DOMAINS } from "../types/activityLog";
import type {
  FilePlanApplySummary,
  FilePlanProgress,
  Source,
} from "../types/source";
import { logActivity } from "./activityLog";
import { t } from "./i18n";
import {
  countTracksBySource,
  describeSourceError,
  sourceDisplayName,
} from "./sourceAccess";
import {
  applyOrganizeSource,
  FILE_PLAN_PROGRESS_EVENT,
  previewOrganizeSource,
  rescanSource,
} from "./tauri";
import { formatPeerOutcomeTitle } from "./toastPeerOutcomes";

/**
 * The finished organize toast, by the bulk operation rules: number-first
 * clauses; one failure inline, more behind View logs; success, warning when
 * some failed, error when none moved.
 */
export function organizeSettleOptions(
  summary: FilePlanApplySummary,
  names: readonly string[],
): BackgroundTaskSettleAsOptions & { label: string } {
  const { moved, failed, errors } = summary;
  const name = names.join(", ");
  const label = formatPeerOutcomeTitle(
    [
      ...(moved > 0
        ? [
            {
              text: t("toasts:organize.moved", { count: moved }),
              anchored: true,
            },
          ]
        : []),
      ...(failed > 0
        ? [{ text: t("toasts:organize.failed", { count: failed }) }]
        : []),
    ],
    {
      operation: t("toasts:organize.operation"),
      fallback: t("toasts:organize.failedFallback", { name }),
    },
  );

  if (failed === 0) return { status: "success", label, detail: name };
  const status = moved > 0 ? "warning" : "error";
  if (failed === 1) {
    return {
      status,
      label,
      detail: errors[0] || t("toasts:organize.failedFallback", { name }),
    };
  }
  return { status, label, logLink: true };
}

/**
 * Organize runs one at a time: moves share one recovery journal, and one
 * folder's moves shouldn't race another's.
 */
let organizeChain: Promise<unknown> = Promise.resolve();

export interface OrganizeJob {
  source: Source;
  /** Organize by this format instead of the source's own. */
  pathFormat?: string;
  /** After this source's files moved, before the toast settles. */
  onApplied?: (summary: FilePlanApplySummary) => Promise<void> | void;
}

interface OrganizeInBackgroundOptions {
  /**
   * Finish scanning each folder first (they were just added), and skip
   * quietly any that turn out to hold no tracks.
   */
  scanFirst?: boolean;
}

/** A job that will move files, with how many the check counted. */
interface PlannedJob extends OrganizeJob {
  name: string;
  moves: number;
}

/**
 * Move sources' files to match their path formats, and turn organizing on.
 * Works out what would move first, quietly: one toast covers every source
 * with files to move ("Organizing A…", then B), its progress the total
 * across them, and appears only when something actually moves. Resolves
 * once done, however it ended.
 */
export function organizeInBackground(
  jobs: readonly OrganizeJob[],
  { scanFirst = false }: OrganizeInBackgroundOptions = {},
): Promise<void> {
  const previous = organizeChain;
  const done = (async () => {
    await previous;
    const planned: PlannedJob[] = [];
    for (const job of jobs) {
      const name = sourceDisplayName(job.source);
      try {
        const moves = await check(job);
        if (moves > 0) planned.push({ ...job, name, moves });
      } catch (err) {
        useBackgroundTasksStore.getState().showErrorToast({
          label: t("toasts:organize.failedFallback", { name }),
          detail: errorMessage(err),
        });
      }
    }
    if (planned.length > 0) await moveAll(planned);
  })();
  organizeChain = done;
  return done;

  /**
   * How many files a job would move. With none, organizing just turns on
   * here (nothing worth a toast); a folder without tracks is left as is.
   */
  async function check(job: OrganizeJob): Promise<number> {
    const { source, pathFormat } = job;
    if (scanFirst) {
      // Returns once the folder is fully scanned, so every file is organized.
      await rescanSource(source.id);
      await usePlayerStore.getState().loadLibrary({ preservePlayback: true });
      const tracks =
        countTracksBySource(usePlayerStore.getState().library).get(source.id)
          ?.total ?? 0;
      if (tracks === 0) return 0;
    }
    const plan = await previewOrganizeSource(source.id, pathFormat);
    if (plan.moves === 0) {
      await applied(job, await applyOrganizeSource(source.id, pathFormat));
    }
    return plan.moves;
  }

  function moveAll(planned: PlannedJob[]): Promise<void> {
    return new Promise<void>((resolve) => {
      useBackgroundTasksStore.getState().runInBackground({
        key: "organize-sources",
        label: t("toasts:organize.running", { name: planned[0].name }),
        progressDisplay: "bar",
        run: async (ctx) => {
          try {
            await moveEach(ctx, planned);
          } finally {
            resolve();
          }
        },
      });
    });
  }

  async function moveEach(
    ctx: BackgroundTaskRunContext,
    planned: PlannedJob[],
  ) {
    const total = planned.reduce((sum, job) => sum + job.moves, 0);
    const outcome: FilePlanApplySummary = { moved: 0, failed: 0, errors: [] };
    let before = 0;
    for (const job of planned) {
      ctx.setLabel(t("toasts:organize.running", { name: job.name }));
      ctx.setProgress(before, total);
      const offset = before;
      const unlisten = await listen<FilePlanProgress>(
        FILE_PLAN_PROGRESS_EVENT,
        (event) => {
          const { sourceId, done } = event.payload;
          if (sourceId === job.source.id) {
            ctx.setProgress(Math.min(offset + done, total), total);
          }
        },
      );
      try {
        const summary = await applyOrganizeSource(
          job.source.id,
          job.pathFormat,
        );
        outcome.moved += summary.moved;
        outcome.failed += summary.failed;
        outcome.errors.push(...summary.errors);
        await applied(job, summary);
      } catch (err) {
        // The rest still organize; this source's files count as failed.
        outcome.failed += job.moves;
        outcome.errors.push(`${job.name}: ${errorMessage(err)}`);
        logActivity({
          level: "warn",
          domain: ACTIVITY_LOG_DOMAINS.library,
          message: "Couldn't organize a source",
          details: { sourceId: job.source.id, error: errorMessage(err) },
        });
      } finally {
        unlisten();
      }
      before += job.moves;
    }
    ctx.settleAs(
      organizeSettleOptions(
        outcome,
        planned.map((job) => job.name),
      ),
    );
  }

  async function applied(job: OrganizeJob, summary: FilePlanApplySummary) {
    if (summary.failed > 0) {
      logActivity({
        level: "warn",
        domain: ACTIVITY_LOG_DOMAINS.library,
        message: "Some files couldn't be organized",
        details: {
          sourceId: job.source.id,
          moved: summary.moved,
          failed: summary.failed,
          errors: summary.errors,
        },
      });
    }
    await useSourcesStore.getState().loadSources();
    await job.onApplied?.(summary);
  }
}

function errorMessage(err: unknown): string {
  return describeSourceError(err);
}
