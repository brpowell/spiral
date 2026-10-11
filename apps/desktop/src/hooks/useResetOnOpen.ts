import { useState } from "react";

/**
 * When `open` becomes true, apply `next` before paint so a remounted panel
 * starts there instead of animating away from the value left by the last close.
 */
export function useResetOnOpen<T>(
  open: boolean,
  next: T,
  current: T,
  apply: (value: T) => void,
): void {
  const [wasOpen, setWasOpen] = useState(open);
  if (open === wasOpen) return;
  setWasOpen(open);
  if (open && !Object.is(current, next)) apply(next);
}
