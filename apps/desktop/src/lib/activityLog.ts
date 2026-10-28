import { invoke } from "@tauri-apps/api/core";
import type {
  ActivityLogContext,
  ActivityLogDraft,
  ActivityLogEntry,
} from "../types/activityLog";
import { normalizeActivityLogEntry } from "./activityLogLine";

export function logActivity(draft: ActivityLogDraft): void {
  void logActivityEntry(draft).catch((err: unknown) => {
    console.error("Failed to append activity log:", err);
  });
}

export async function logActivityEntry(
  draft: ActivityLogDraft,
): Promise<ActivityLogEntry> {
  const raw = await invoke<Record<string, unknown>>("append_activity_log", {
    draft,
  });
  return normalizeActivityLogEntry(raw);
}

export function withLogContext(
  base: ActivityLogContext | undefined,
  patch: ActivityLogContext,
): ActivityLogContext {
  return {
    ...base,
    ...patch,
  };
}
