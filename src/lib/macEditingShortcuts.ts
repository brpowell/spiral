import { flushSync } from "react-dom";
import type { KeyboardEvent } from "react";

// Tauri's macOS WebView does not wire up Cmd+A (select-all) or Cmd+Z (undo/redo)
// by default the way a real browser does. These have to be handled explicitly.
export function applyMacEditingShortcuts<
  T extends HTMLInputElement | HTMLTextAreaElement,
>(
  e: KeyboardEvent<T>,
  undo: () => string | null,
  redo: () => string | null,
  syncChange: (el: T) => void,
): boolean {
  const mod = e.metaKey || e.ctrlKey;
  if (!mod) return false;

  if (e.key === "a") {
    e.currentTarget.select();
    return true;
  }

  if (e.key === "z") {
    e.preventDefault();
    const el = e.currentTarget;
    const restored = e.shiftKey ? redo() : undo();
    if (restored !== null) {
      el.value = restored;
      flushSync(() => {
        syncChange(el);
      });
    }
    return true;
  }

  return false;
}
