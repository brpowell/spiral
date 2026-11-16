import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
} from "react";
import { createPortal } from "react-dom";
import { placeTooltip } from "@/lib/ui/tooltipPosition";
import "./Tooltip.css";

const OPEN_DELAY_MS = 400;
/** Lets the pointer travel from the trigger onto the tooltip without it closing. */
const CLOSE_GRACE_MS = 120;
/** A tooltip opened this soon after another closed skips the delay, like a toolbar being scanned. */
const WARM_WINDOW_MS = 400;
/** Space between the trigger and the tooltip. */
const GAP = 8;
/** How far the tooltip dashes, from the trigger's side, as it appears. */
const FLY_DISTANCE = 14;

/** Start offset: below its final spot when the tooltip sits above the trigger, and vice versa. */
function flyOffset(side: "top" | "bottom"): number {
  return side === "top" ? FLY_DISTANCE : -FLY_DISTANCE;
}

let lastClosedAt = 0;

type TriggerProps = {
  ref?: Ref<HTMLElement>;
  "aria-describedby"?: string;
  onPointerEnter?: (e: PointerEvent<HTMLElement>) => void;
  onPointerLeave?: (e: PointerEvent<HTMLElement>) => void;
  onFocus?: (e: FocusEvent<HTMLElement>) => void;
  onBlur?: (e: FocusEvent<HTMLElement>) => void;
};

export type TooltipProps = {
  /** What to show. Nothing renders (and no handlers act) when this is empty. */
  content: ReactNode;
  /** The element the tooltip belongs to. It receives the hover, focus and ARIA wiring. */
  children: ReactElement<TriggerProps>;
  /** Preferred side. Flips to the other side when there isn't room. */
  placement?: "top" | "bottom";
  /** Wait before opening on hover. Keyboard focus always opens immediately. */
  openDelayMs?: number;
  /**
   * Point the trigger's `aria-describedby` at the tooltip while it is open. Turn this off when the
   * trigger already carries the same words as its accessible name or description, so a screen
   * reader doesn't read them twice.
   */
  describeTrigger?: boolean;
};

function isFocusVisible(el: Element): boolean {
  try {
    return el.matches(":focus-visible");
  } catch {
    return true;
  }
}

/**
 * A small hover and focus hint anchored to its trigger, rendered by the app rather than the OS.
 *
 * Opens on mouse hover after a short delay and immediately on keyboard focus. It closes on
 * pointer leave, blur, Escape, and scrolling, and stays open while the pointer is over it, so
 * the content can be read and selected. Touch input is ignored because it has no hover.
 */
export function Tooltip({
  content,
  children,
  placement = "top",
  openDelayMs = OPEN_DELAY_MS,
  describeTrigger = true,
}: TooltipProps) {
  const id = useId();
  const reduceMotion = useReducedMotion() === true;
  const triggerRef = useRef<HTMLElement | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const openTimer = useRef<number | undefined>(undefined);
  const closeTimer = useRef<number | undefined>(undefined);
  const openRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{
    left: number;
    top: number;
    side: "top" | "bottom";
  } | null>(null);

  const hasContent = content != null && content !== false && content !== "";

  openRef.current = open;

  const clearTimers = useCallback(() => {
    window.clearTimeout(openTimer.current);
    window.clearTimeout(closeTimer.current);
  }, []);

  const show = useCallback((delayMs: number) => {
    window.clearTimeout(closeTimer.current);
    if (openRef.current) return;
    window.clearTimeout(openTimer.current);
    if (delayMs <= 0) {
      setOpen(true);
      return;
    }
    openTimer.current = window.setTimeout(() => setOpen(true), delayMs);
  }, []);

  const hide = useCallback((delayMs: number) => {
    window.clearTimeout(openTimer.current);
    window.clearTimeout(closeTimer.current);
    if (delayMs <= 0) {
      setOpen(false);
      return;
    }
    closeTimer.current = window.setTimeout(() => setOpen(false), delayMs);
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  const wasOpen = useRef(false);
  useEffect(() => {
    // Only a real open -> closed transition counts, not the initial mount.
    if (wasOpen.current && !open) lastClosedAt = Date.now();
    wasOpen.current = open;
  }, [open]);

  useLayoutEffect(() => {
    const trigger = triggerRef.current;
    const tip = tipRef.current;
    if (!open || !trigger || !tip) return;
    const triggerRect = trigger.getBoundingClientRect();
    const {
      left,
      top,
      placement: side,
    } = placeTooltip({
      trigger: triggerRect,
      // Layout size, not getBoundingClientRect: the fly-in transform would skew the latter.
      tooltip: { width: tip.offsetWidth, height: tip.offsetHeight },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      placement,
      gap: GAP,
    });
    setPosition({ left, top, side });
  }, [open, content, placement]);

  useEffect(() => {
    if (!open) return;
    const dismiss = () => setOpen(false);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Dismiss only the tooltip: a surrounding modal or selection shouldn't also react.
      e.stopPropagation();
      setOpen(false);
    };
    const onPointerDown = (e: globalThis.PointerEvent) => {
      if (tipRef.current?.contains(e.target as Node)) return;
      dismiss();
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("wheel", dismiss, { capture: true, passive: true });
    window.addEventListener("resize", dismiss);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("wheel", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [open]);

  const child = children;
  const childProps = child.props;

  const setTriggerRef = useCallback(
    (node: HTMLElement | null) => {
      triggerRef.current = node;
      const own = childProps.ref;
      if (typeof own === "function") own(node);
      else if (own) own.current = node;
    },
    [childProps.ref],
  );

  const trigger = hasContent
    ? cloneElement(child, {
        ref: setTriggerRef,
        "aria-describedby":
          open && describeTrigger ? id : childProps["aria-describedby"],
        onPointerEnter: (e: PointerEvent<HTMLElement>) => {
          childProps.onPointerEnter?.(e);
          if (e.pointerType === "touch") return;
          show(Date.now() - lastClosedAt < WARM_WINDOW_MS ? 0 : openDelayMs);
        },
        onPointerLeave: (e: PointerEvent<HTMLElement>) => {
          childProps.onPointerLeave?.(e);
          hide(CLOSE_GRACE_MS);
        },
        onFocus: (e: FocusEvent<HTMLElement>) => {
          childProps.onFocus?.(e);
          // Mouse clicks also focus; hover already covers those.
          if (isFocusVisible(e.currentTarget)) show(0);
        },
        onBlur: (e: FocusEvent<HTMLElement>) => {
          childProps.onBlur?.(e);
          hide(0);
        },
      })
    : child;

  return (
    <>
      {trigger}
      {createPortal(
        <AnimatePresence>
          {open && hasContent && (
            <motion.div
              key="tooltip"
              ref={tipRef}
              id={id}
              role="tooltip"
              className="tooltip"
              style={
                position
                  ? { left: position.left, top: position.top }
                  : { left: 0, top: 0, visibility: "hidden" }
              }
              initial={
                reduceMotion
                  ? false
                  : {
                      opacity: 0,
                      y: flyOffset(position?.side ?? placement),
                    }
              }
              animate={{ opacity: 1, y: 0 }}
              exit={
                reduceMotion
                  ? { opacity: 0 }
                  : {
                      opacity: 0,
                      y: flyOffset(position?.side ?? placement) / 3,
                      transition: { duration: 0.09 },
                    }
              }
              transition={
                reduceMotion
                  ? { duration: 0 }
                  : {
                      opacity: { duration: 0.1, ease: "easeOut" },
                      // Quick and decisive: a fast ease-out dash, no spring settle.
                      y: { duration: 0.16, ease: [0.16, 1, 0.3, 1] },
                    }
              }
              onPointerEnter={() => window.clearTimeout(closeTimer.current)}
              onPointerLeave={() => hide(CLOSE_GRACE_MS)}
            >
              {content}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
