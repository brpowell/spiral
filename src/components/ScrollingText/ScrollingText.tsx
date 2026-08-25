import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import "./ScrollingText.css";

const PAUSE_BEFORE_MS = 4_500;
const PAUSE_AT_END_MS = 3_000;
const SCROLL_PX_PER_SEC = 26;
const RESET_PX_PER_SEC = 32;
/** WMP-style marquee (~2px / 80ms). */
const MARQUEE_PX_PER_SEC = 25;
/** Must match `.scrolling-text--marquee .scrolling-text__track { gap }`. */
const MARQUEE_GAP_PX = 32;

export type ScrollingTextMode = "bounce" | "marquee";

interface ScrollingTextProps {
  text: string;
  className?: string;
  /** `bounce` = pause, scroll, pause, snap back (default). `marquee` = seamless loop. */
  mode?: ScrollingTextMode;
  /** Inline content (e.g. links). Falls back to `text`. */
  children?: ReactNode;
}

export function ScrollingText({
  text,
  className = "",
  mode = "bounce",
  children,
}: ScrollingTextProps) {
  const content = children ?? text;
  const containerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLSpanElement>(null);
  const trackRef = useRef<HTMLSpanElement>(null);
  const firstSegmentRef = useRef<HTMLSpanElement>(null);
  const secondSegmentRef = useRef<HTMLSpanElement>(null);
  const animationRef = useRef<Animation | null>(null);
  const [overflow, setOverflow] = useState(0);
  const [marqueeLoopPx, setMarqueeLoopPx] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduceMotion(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const measureBounce = useCallback(() => {
    const container = containerRef.current;
    const inner = innerRef.current;
    if (!container || !inner) return;
    setOverflow(Math.max(0, inner.scrollWidth - container.clientWidth));
  }, []);

  const measureMarquee = useCallback(() => {
    const container = containerRef.current;
    const first = firstSegmentRef.current;
    const second = secondSegmentRef.current;
    if (!container || !first) return;

    const textOverflows = first.scrollWidth > container.clientWidth;

    // Prefer live layout when the duplicate is visible (active); fall back so we
    // don't require it for the initial overflow check (duplicate is display:none until active).
    let loopPx = first.offsetWidth + MARQUEE_GAP_PX;
    if (second && second.offsetLeft > first.offsetLeft) {
      loopPx = second.offsetLeft - first.offsetLeft;
    }

    setMarqueeLoopPx(loopPx);
    setOverflow(
      textOverflows
        ? Math.max(1, first.scrollWidth - container.clientWidth)
        : 0,
    );
  }, []);

  const measure = mode === "marquee" ? measureMarquee : measureBounce;

  useLayoutEffect(() => {
    measure();
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    const track = trackRef.current;
    if (mode === "marquee" && track) {
      observer.observe(track);
      if (firstSegmentRef.current) observer.observe(firstSegmentRef.current);
      if (secondSegmentRef.current) observer.observe(secondSegmentRef.current);
    }
    return () => observer.disconnect();
  }, [text, measure, mode, overflow]);

  useLayoutEffect(() => {
    animationRef.current?.cancel();
    animationRef.current = null;

    if (mode === "marquee") {
      const track = trackRef.current;
      if (!track) return;

      if (overflow <= 0 || reduceMotion || marqueeLoopPx <= 0) {
        track.style.transform = "";
        return;
      }

      const durationMs = (marqueeLoopPx / MARQUEE_PX_PER_SEC) * 1000;
      const anim = track.animate(
        [
          { transform: "translate3d(0, 0, 0)" },
          { transform: `translate3d(-${marqueeLoopPx}px, 0, 0)` },
        ],
        {
          duration: durationMs,
          iterations: Infinity,
          easing: "linear",
        },
      );
      animationRef.current = anim;
      return () => anim.cancel();
    }

    const inner = innerRef.current;
    if (!inner) return;

    if (overflow <= 0 || reduceMotion) {
      inner.style.transform = "";
      return;
    }

    const scrollMs = (overflow / SCROLL_PX_PER_SEC) * 1000;
    const resetMs = (overflow / RESET_PX_PER_SEC) * 1000;
    const total = PAUSE_BEFORE_MS + scrollMs + PAUSE_AT_END_MS + resetMs;

    const pauseEnd = PAUSE_BEFORE_MS / total;
    const scrollEnd = (PAUSE_BEFORE_MS + scrollMs) / total;
    const holdEnd = (PAUSE_BEFORE_MS + scrollMs + PAUSE_AT_END_MS) / total;

    const anim = inner.animate(
      [
        { transform: "translateX(0)", offset: 0 },
        { transform: "translateX(0)", offset: pauseEnd },
        {
          transform: `translateX(-${overflow}px)`,
          offset: scrollEnd,
          easing: "ease-in-out",
        },
        { transform: `translateX(-${overflow}px)`, offset: holdEnd },
        { transform: "translateX(0)", offset: 1, easing: "ease-in-out" },
      ],
      { duration: total, iterations: Infinity },
    );
    animationRef.current = anim;

    return () => anim.cancel();
  }, [overflow, text, reduceMotion, mode, marqueeLoopPx]);

  const overflows = overflow > 0;
  const active = overflows && !reduceMotion;

  const rootClass = [
    "scrolling-text",
    active && "scrolling-text--active",
    mode === "marquee" && "scrolling-text--marquee",
    overflows && reduceMotion && "scrolling-text--truncated",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  if (mode === "marquee") {
    return (
      <div ref={containerRef} className={rootClass} title={text}>
        <span ref={trackRef} className="scrolling-text__track">
          <span ref={firstSegmentRef} className="scrolling-text__segment">
            {content}
          </span>
          <span
            ref={secondSegmentRef}
            className="scrolling-text__segment"
            aria-hidden="true"
          >
            {content}
          </span>
        </span>
      </div>
    );
  }

  return (
    <div ref={containerRef} className={rootClass} title={text}>
      <span ref={innerRef} className="scrolling-text__inner">
        {content}
      </span>
    </div>
  );
}
