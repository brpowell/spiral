import { flushSync } from "react-dom";
import type { KeyboardEvent } from "react";
import { copyTextToClipboard, readTextFromClipboard } from "./clipboard";

// Tauri's macOS WebView does not wire up standard editing shortcuts (select-all,
// undo/redo, copy/cut/paste) the way a real browser does. Handle them explicitly.
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

  const key = e.key.toLowerCase();
  const el = e.currentTarget;

  if (key === "a") {
    e.preventDefault();
    el.select();
    return true;
  }

  if (key === "z") {
    e.preventDefault();
    const restored = e.shiftKey ? redo() : undo();
    if (restored !== null) {
      el.value = restored;
      flushSync(() => {
        syncChange(el);
      });
    }
    return true;
  }

  if (key === "c") {
    e.preventDefault();
    const { start, end } = selectionBounds(el);
    if (start !== end) {
      void copyTextToClipboard(el.value.slice(start, end));
    }
    return true;
  }

  if (key === "x") {
    e.preventDefault();
    const { start, end } = selectionBounds(el);
    if (start === end) return true;

    const selected = el.value.slice(start, end);
    void copyTextToClipboard(selected).then((copied) => {
      if (!copied) return;
      el.value = el.value.slice(0, start) + el.value.slice(end);
      el.setSelectionRange(start, start);
      flushSync(() => {
        syncChange(el);
      });
    });
    return true;
  }

  if (key === "v") {
    e.preventDefault();
    void readTextFromClipboard().then((text) => {
      if (text === null) return;
      replaceSelection(el, text, syncChange);
    });
    return true;
  }

  return false;
}

function selectionBounds(el: HTMLInputElement | HTMLTextAreaElement) {
  const start = el.selectionStart ?? 0;
  const end = el.selectionEnd ?? 0;
  return { start, end };
}

function replaceSelection<T extends HTMLInputElement | HTMLTextAreaElement>(
  el: T,
  text: string,
  syncChange: (el: T) => void,
): void {
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  el.value = el.value.slice(0, start) + text + el.value.slice(end);
  const caret = start + text.length;
  el.setSelectionRange(caret, caret);
  flushSync(() => {
    syncChange(el);
  });
}
