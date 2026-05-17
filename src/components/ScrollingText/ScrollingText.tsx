import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import "./ScrollingText.css";

const PAUSE_BEFORE_MS = 4_500;
const PAUSE_AT_END_MS = 3_000;
const SCROLL_PX_PER_SEC = 26;
const RESET_PX_PER_SEC = 32;

interface ScrollingTextProps {
  text: string;
  className?: string;
}

export function ScrollingText({ text, className = "" }: ScrollingTextProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLSpanElement>(null);
  const animationRef = useRef<Animation | null>(null);
  const [overflow, setOverflow] = useState(0);
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

  const measure = useCallback(() => {
    const container = containerRef.current;
    const inner = innerRef.current;
    if (!container || !inner) return;
    setOverflow(Math.max(0, inner.scrollWidth - container.clientWidth));
  }, []);

  useLayoutEffect(() => {
    measure();
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [text, measure]);

  useLayoutEffect(() => {
    const inner = innerRef.current;
    if (!inner) return;

    animationRef.current?.cancel();
    animationRef.current = null;

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
  }, [overflow, text, reduceMotion]);

  const overflows = overflow > 0;
  const active = overflows && !reduceMotion;

  return (
    <div
      ref={containerRef}
      className={`scrolling-text${active ? " scrolling-text--active" : ""}${overflows && reduceMotion ? " scrolling-text--truncated" : ""
        } ${className}`.trim()}
      title={text}
    >
      <span ref={innerRef} className="scrolling-text__inner">
        {text}
      </span>
    </div>
  );
}
