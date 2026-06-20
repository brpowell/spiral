import { useCallback, useRef } from "react";

export type InputEditHistory = {
  /** Update the tracked value without pushing an undo entry (programmatic edits). */
  setValueWithoutRecord: (value: string) => void;
  /** Replace the value and make the previous value restorable via undo. */
  replaceWithUndo: (value: string) => void;
};

/**
 * Per-input undo/redo stack. document.execCommand('undo') is document-wide in
 * Tauri's WebView and bleeds across unrelated fields; this scopes history to
 * one input.
 */
export function useInputEditHistory() {
  const undoStack = useRef<string[]>([]);
  const redoStack = useRef<string[]>([]);
  const lastValue = useRef("");
  const suppressNext = useRef(false);

  const reset = useCallback((value: string) => {
    undoStack.current = [];
    redoStack.current = [];
    lastValue.current = value;
    suppressNext.current = false;
  }, []);

  const recordChange = useCallback((newValue: string) => {
    if (suppressNext.current) {
      suppressNext.current = false;
      lastValue.current = newValue;
      return;
    }
    if (newValue !== lastValue.current) {
      undoStack.current.push(lastValue.current);
      redoStack.current = [];
      lastValue.current = newValue;
    }
  }, []);

  const setValueWithoutRecord = useCallback((value: string) => {
    suppressNext.current = true;
    lastValue.current = value;
  }, []);

  const replaceWithUndo = useCallback((newValue: string) => {
    if (newValue === lastValue.current) return;
    undoStack.current.push(lastValue.current);
    redoStack.current = [];
    lastValue.current = newValue;
    suppressNext.current = true;
  }, []);

  const undo = useCallback((): string | null => {
    const prev = undoStack.current.pop();
    if (prev === undefined) return null;
    redoStack.current.push(lastValue.current);
    lastValue.current = prev;
    suppressNext.current = true;
    return prev;
  }, []);

  const redo = useCallback((): string | null => {
    const next = redoStack.current.pop();
    if (next === undefined) return null;
    undoStack.current.push(lastValue.current);
    lastValue.current = next;
    suppressNext.current = true;
    return next;
  }, []);

  return {
    reset,
    recordChange,
    undo,
    redo,
    setValueWithoutRecord,
    replaceWithUndo,
  };
}
