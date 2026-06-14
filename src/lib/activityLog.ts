import { invoke } from "@tauri-apps/api/core";
import type { ActivityLogContext, ActivityLogDraft } from "../types/activityLog";

export function logActivity(draft: ActivityLogDraft): void {
  void invoke("append_activity_log", { draft }).catch((err: unknown) => {
    console.error("Failed to append activity log:", err);
  });
}

export function createOperationId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
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
