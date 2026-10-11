import { useSyncExternalStore } from "react";

let suppressed = false;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

function onDocumentPointerMove(): void {
  if (!suppressed) return;
  suppressed = false;
  notify();
}

let listening = false;

function ensureDocumentListener(): void {
  if (listening) return;
  listening = true;
  window.addEventListener("pointermove", onDocumentPointerMove, {
    passive: true,
  });
}

/** Survives control unmount (e.g. play/pause swap) until the pointer moves. */
export function suppressSkinButtonHoverUntilPointerMove(): void {
  if (suppressed) return;
  suppressed = true;
  ensureDocumentListener();
  notify();
}

function getSuppressedSnapshot(): boolean {
  return suppressed;
}

function subscribeSuppressed(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => listeners.delete(onStoreChange);
}

export function useSkinButtonHoverSuppressed(): boolean {
  return useSyncExternalStore(
    subscribeSuppressed,
    getSuppressedSnapshot,
    () => false,
  );
}
