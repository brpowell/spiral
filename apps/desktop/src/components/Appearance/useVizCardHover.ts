import { useCallback, useEffect, useRef, useState } from "react";

const HOVER_ENTER_MS = 50;
const HOVER_LEAVE_MS = 300;

/**
 * Debounced "which visualizer card is hovered", so skimming the pointer across
 * a row doesn't spin up (and tear down) a live preview for every card.
 */
export function useVizCardHover(disabled: boolean) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const enterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingHoverRef = useRef<string | null>(null);

  const clearTimers = useCallback(() => {
    if (enterTimerRef.current) {
      clearTimeout(enterTimerRef.current);
      enterTimerRef.current = null;
    }
    if (leaveTimerRef.current) {
      clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
  }, []);

  useEffect(() => () => clearTimers(), [clearTimers]);

  const onEnter = useCallback(
    (id: string) => {
      if (disabled) return;
      pendingHoverRef.current = id;
      if (leaveTimerRef.current) {
        clearTimeout(leaveTimerRef.current);
        leaveTimerRef.current = null;
      }
      if (enterTimerRef.current) clearTimeout(enterTimerRef.current);
      enterTimerRef.current = setTimeout(() => {
        enterTimerRef.current = null;
        if (pendingHoverRef.current === id) {
          setHoveredId(id);
        }
      }, HOVER_ENTER_MS);
    },
    [disabled],
  );

  const onLeave = useCallback((id: string) => {
    if (pendingHoverRef.current === id) {
      pendingHoverRef.current = null;
    }
    if (enterTimerRef.current) {
      clearTimeout(enterTimerRef.current);
      enterTimerRef.current = null;
    }
    if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
    leaveTimerRef.current = setTimeout(() => {
      leaveTimerRef.current = null;
      setHoveredId((current) => (current === id ? null : current));
    }, HOVER_LEAVE_MS);
  }, []);

  return { hoveredId, onEnter, onLeave };
}
