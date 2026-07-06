import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { ACTIVITY_LOG_EVENT } from "../types/activityLog";
import { useActivityLogStore } from "../store/useActivityLogStore";
import { normalizeActivityLogEntry } from "./activityLogLine";

export async function initActivityLogBridge(): Promise<() => void> {
  const recent = await invoke<Record<string, unknown>[]>(
    "get_recent_activity_logs",
    {
      limit: 500,
      domainPrefix: null,
    },
  );
  useActivityLogStore.getState().hydrate(recent.map(normalizeActivityLogEntry));

  const unlisten = await listen<Record<string, unknown>>(
    ACTIVITY_LOG_EVENT,
    (event) => {
      useActivityLogStore.getState().append(normalizeActivityLogEntry(event.payload));
    },
  );

  return unlisten;
}

export async function clearActivityLogsRemote(): Promise<void> {
  await invoke("clear_activity_logs");
  useActivityLogStore.getState().clear();
}
