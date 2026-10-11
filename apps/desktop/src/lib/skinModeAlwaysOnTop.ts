import { useSyncExternalStore } from "react";
import { DEFAULT_SKIN_MODE_ALWAYS_ON_TOP } from "./skinModeWindowState";

let alwaysOnTop = DEFAULT_SKIN_MODE_ALWAYS_ON_TOP;
const listeners = new Set<() => void>();

export function getSkinModeAlwaysOnTopSnapshot(): boolean {
  return alwaysOnTop;
}

export function setSkinModeAlwaysOnTopSnapshot(value: boolean): void {
  if (alwaysOnTop === value) return;
  alwaysOnTop = value;
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeSkinModeAlwaysOnTop(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSkinModeAlwaysOnTop(): boolean {
  return useSyncExternalStore(
    subscribeSkinModeAlwaysOnTop,
    getSkinModeAlwaysOnTopSnapshot,
    getSkinModeAlwaysOnTopSnapshot,
  );
}
