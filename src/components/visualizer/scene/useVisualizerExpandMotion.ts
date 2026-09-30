import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type AnimationEvent,
} from "react";
import { usePrefersReducedMotion } from "../context";

type VisualizerExpandStage = "mini" | "expanded";
type VisualizerExpandMotion = "idle" | "recede" | "emerge";

/**
 * Durations match `audio-visualizer-recede` / `audio-visualizer-emerge`
 * in audioVisualizer.css. The timeout is only a fallback if animationend
 * never fires.
 */
const RECEDE_MS = 80;
const EMERGE_MS = 110;
const MOTION_END_GRACE_MS = 40;

const RECEDE_ANIMATION = "audio-visualizer-recede";
const EMERGE_ANIMATION = "audio-visualizer-emerge";

interface AppBodyFrame {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * Viewport box of the library region (below the platform title bar and the
 * now-playing header). Measuring the live element keeps the expanded
 * visualizer aligned when Windows/Linux draw an in-app title bar and when
 * macOS draws the overlay bar.
 */
export function useAppBodyFrame(active: boolean): AppBodyFrame | null {
  const [frame, setFrame] = useState<AppBodyFrame | null>(null);

  useLayoutEffect(() => {
    if (!active) {
      setFrame(null);
      return;
    }

    const el = document.querySelector<HTMLElement>(".app-body");
    if (!el) return;

    const publish = () => {
      const next = el.getBoundingClientRect();
      setFrame((prev) =>
        prev &&
        prev.top === next.top &&
        prev.left === next.left &&
        prev.width === next.width &&
        prev.height === next.height
          ? prev
          : {
              top: next.top,
              left: next.left,
              width: next.width,
              height: next.height,
            },
      );
    };

    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    return () => observer.disconnect();
  }, [active]);

  return frame;
}

/**
 * Expand/collapse plays in two beats: the current surface recedes into the
 * page, then the other surface comes back out. `stage` is what is mounted;
 * `expanded` is the requested end state, so a second click during the
 * transition reverses direction.
 */
export function useVisualizerExpandMotion(expanded: boolean, enabled: boolean) {
  const reduced = usePrefersReducedMotion();
  const [stage, setStage] = useState<VisualizerExpandStage>(
    expanded ? "expanded" : "mini",
  );
  const [motion, setMotion] = useState<VisualizerExpandMotion>("idle");

  const stageRef = useRef(stage);
  const motionRef = useRef(motion);
  const expandedRef = useRef(expanded);
  stageRef.current = stage;
  motionRef.current = motion;
  expandedRef.current = expanded;

  const advance = useCallback((expected: VisualizerExpandMotion) => {
    if (motionRef.current !== expected) return;
    const next: VisualizerExpandStage = expandedRef.current
      ? "expanded"
      : "mini";
    if (expected === "recede") {
      setStage(next);
      setMotion("emerge");
      return;
    }
    setMotion(next === stageRef.current ? "idle" : "recede");
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const next: VisualizerExpandStage = expanded ? "expanded" : "mini";
    if (reduced) {
      setStage(next);
      setMotion("idle");
      return;
    }
    if (next === stage) {
      if (motion === "recede") setMotion("emerge");
      return;
    }
    if (motion !== "recede") setMotion("recede");
  }, [enabled, expanded, reduced, stage, motion]);

  useEffect(() => {
    if (!enabled || motion === "idle") return;
    const expected = motion;
    const ms =
      (motion === "recede" ? RECEDE_MS : EMERGE_MS) + MOTION_END_GRACE_MS;
    const id = window.setTimeout(() => advance(expected), ms);
    return () => window.clearTimeout(id);
  }, [advance, enabled, motion]);

  const onAnimationEnd = (event: AnimationEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    const name = event.animationName;
    if (name !== RECEDE_ANIMATION && name !== EMERGE_ANIMATION) return;
    advance(name === RECEDE_ANIMATION ? "recede" : "emerge");
  };

  return { stage, motion, onAnimationEnd };
}
