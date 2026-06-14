import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { ACTIVITY_LOG_EVENT } from "../types/activityLog";
import type { ActivityLogEntry } from "../types/activityLog";
import { useActivityLogStore } from "../store/useActivityLogStore";

function normalizeEntry(raw: Record<string, unknown>): ActivityLogEntry {
  return {
    id: String(raw.id ?? ""),
    timestampMs: Number(raw.timestampMs ?? raw.timestamp_ms ?? Date.now()),
    level: (raw.level as ActivityLogEntry["level"]) ?? "info",
    domain: String(raw.domain ?? ""),
    message: String(raw.message ?? ""),
    operationId:
      raw.operationId != null
        ? String(raw.operationId)
        : raw.operation_id != null
          ? String(raw.operation_id)
          : undefined,
    context:
      raw.context != null && typeof raw.context === "object"
        ? (raw.context as ActivityLogEntry["context"])
        : undefined,
    details:
      raw.details != null && typeof raw.details === "object"
        ? (raw.details as Record<string, unknown>)
        : undefined,
  };
}

export async function initActivityLogBridge(): Promise<() => void> {
  const recent = await invoke<Record<string, unknown>[]>(
    "get_recent_activity_logs",
    {
      limit: 500,
      domainPrefix: null,
    },
  );
  useActivityLogStore.getState().hydrate(recent.map(normalizeEntry));

  const unlisten = await listen<Record<string, unknown>>(
    ACTIVITY_LOG_EVENT,
    (event) => {
      useActivityLogStore.getState().append(normalizeEntry(event.payload));
    },
  );

  return unlisten;
}

export async function clearActivityLogsRemote(): Promise<void> {
  await invoke("clear_activity_logs");
  useActivityLogStore.getState().clear();
}
