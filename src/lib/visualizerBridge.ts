import { emit, listen } from "@tauri-apps/api/event";
import { useVisualizerStore } from "../store/useVisualizerStore";
import type { WindowRole } from "./windowRole";
import { isAnySkinWindow, isAppearanceWindow } from "./windowRole";

export const VISUALIZER_CHANGED_EVENT = "visualizer://changed";

export interface VisualizerChangedPayload {
  packId: string;
}

async function applyVisualizerChange(packId: string): Promise<void> {
  await useVisualizerStore.getState().applyActivePack(packId);
}

function shouldListenForVisualizerChanges(role: WindowRole): boolean {
  return role === "main" || isAnySkinWindow() || isAppearanceWindow();
}

export async function initVisualizerBridge(
  role: WindowRole,
): Promise<() => void> {
  if (!shouldListenForVisualizerChanges(role)) {
    return async () => {};
  }

  const unlisten = await listen<VisualizerChangedPayload>(
    VISUALIZER_CHANGED_EVENT,
    (event) => {
      void applyVisualizerChange(event.payload.packId).catch((err: unknown) => {
        console.error("Failed to apply visualizer change:", err);
      });
    },
  );

  return () => {
    unlisten();
  };
}

export function emitVisualizerChanged(packId: string): void {
  void emit(VISUALIZER_CHANGED_EVENT, { packId } satisfies VisualizerChangedPayload);
}
