import { toAssetUrl } from "../../lib/assetUrl";
import { useCallback, useEffect, useRef, type RefObject } from "react";
import { createPortal } from "react-dom";
import { ensureAnalyser, getAnalyser } from "../../lib/audioAnalyser";
import {
  extractPaletteFromImageUrl,
  getDefaultPalette,
} from "../../lib/palette";
import { usePlayerStore } from "../../store/usePlayerStore";
import { Button } from "../common/Button/Button";
import { IconVisualizer } from "../icons";
import "./AudioVisualizer.css";

interface AudioVisualizerProps {
  variant?: "mini" | "dock";
  expanded: boolean;
  onToggleExpand: () => void;
}

const BAR_COUNT = 64;
const IDLE_SPEED = 0.00032;
const IDLE_WAVE_FREQ = 180;
const IDLE_WAVE_SPREAD = 0.22;
const IDLE_WAVE_AMP = 0.22;
const IDLE_WAVE_BASE = 0.1;

function lerpColor(a: string, b: string, t: number): string {
  const parse = (hex: string) => {
    const h = hex.replace("#", "");
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
    ] as const;
  };
  const [r1, g1, b1] = parse(a);
  const [r2, g2, b2] = parse(b);
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const bl = Math.round(b1 + (b2 - b1) * t);
  return `rgb(${r}, ${g}, ${bl})`;
}

function resetCanvasSize(canvas: HTMLCanvasElement) {
  canvas.width = 0;
  canvas.height = 0;
  canvas.style.width = "";
  canvas.style.height = "";
}

export function AudioVisualizer({
  variant = "dock",
  expanded,
  onToggleExpand,
}: AudioVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const expandedContainerRef = useRef<HTMLDivElement>(null);
  const paletteRef = useRef<string[]>(getDefaultPalette());
  const dataArrayRef = useRef<Uint8Array | null>(null);
  const idlePhaseRef = useRef(0);

  const currentTrackId = usePlayerStore((s) => s.currentTrackId);
  const playbackState = usePlayerStore((s) => s.playbackState);
  const library = usePlayerStore((s) => s.library);

  const currentTrack = library.find((t) => t.id === currentTrackId);
  const isPlaying = playbackState === "playing";
  const isMini = variant === "mini";
  const showExpanded = isMini && expanded;

  useEffect(() => {
    let cancelled = false;
    const artPath = currentTrack?.artPath;

    if (!artPath) {
      paletteRef.current = getDefaultPalette();
      return;
    }

    void toAssetUrl(artPath).then((url) =>
      extractPaletteFromImageUrl(url).then((colors) => {
        if (!cancelled) {
          paletteRef.current = colors;
        }
      }),
    );

    return () => {
      cancelled = true;
    };
  }, [currentTrack?.artPath, currentTrackId]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = showExpanded
      ? expandedContainerRef.current
      : containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = container.clientWidth;
    const height = container.clientHeight;

    if (width === 0 || height === 0) return;

    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    ctx.clearRect(0, 0, width, height);

    const colors = paletteRef.current;
    const barWidth = width / BAR_COUNT;
    const gap = Math.max(1, barWidth * 0.18);
    const drawWidth = barWidth - gap;

    ensureAnalyser();
    const analyser = getAnalyser();

    if (isPlaying && analyser) {
      if (!dataArrayRef.current) {
        dataArrayRef.current = new Uint8Array(analyser.frequencyBinCount);
      }
      const data = dataArrayRef.current;
      analyser.getByteFrequencyData(data);

      for (let i = 0; i < BAR_COUNT; i++) {
        const dataIndex = Math.floor((i / BAR_COUNT) * data.length);
        const value = data[dataIndex] ?? 0;
        const barHeight = (value / 255) * height * 0.92;
        const x = i * barWidth + gap / 2;
        const y = height - barHeight;

        const t = i / (BAR_COUNT - 1);
        const colorIndex = t * (colors.length - 1);
        const idx = Math.floor(colorIndex);
        const frac = colorIndex - idx;
        const c1 = colors[idx] ?? colors[0]!;
        const c2 = colors[Math.min(idx + 1, colors.length - 1)] ?? c1;
        ctx.fillStyle = lerpColor(c1, c2, frac);
        ctx.fillRect(x, y, drawWidth, barHeight);
      }
    } else {
      idlePhaseRef.current += IDLE_SPEED;
      const phase = idlePhaseRef.current;

      for (let i = 0; i < BAR_COUNT; i++) {
        const wave =
          (Math.sin(phase * IDLE_WAVE_FREQ + i * IDLE_WAVE_SPREAD) + 1) *
          0.5 *
          IDLE_WAVE_AMP +
          IDLE_WAVE_BASE;
        const barHeight = wave * height;
        const x = i * barWidth + gap / 2;
        const y = height - barHeight;

        const t = i / (BAR_COUNT - 1);
        const colorIndex = t * (colors.length - 1);
        const idx = Math.floor(colorIndex);
        const frac = colorIndex - idx;
        const c1 = colors[idx] ?? colors[0]!;
        const c2 = colors[Math.min(idx + 1, colors.length - 1)] ?? c1;
        ctx.globalAlpha = 0.45;
        ctx.fillStyle = lerpColor(c1, c2, frac);
        ctx.fillRect(x, y, drawWidth, barHeight);
        ctx.globalAlpha = 1;
      }
    }
  }, [isPlaying, showExpanded]);

  useEffect(() => {
    let rafId = 0;

    const loop = () => {
      draw();
      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [draw]);

  useEffect(() => {
    const containers = [containerRef.current, expandedContainerRef.current].filter(
      Boolean,
    ) as HTMLDivElement[];

    const observer = new ResizeObserver(() => {
      draw();
    });

    for (const el of containers) {
      observer.observe(el);
    }
    return () => observer.disconnect();
  }, [draw, showExpanded]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    resetCanvasSize(canvas);
    requestAnimationFrame(draw);
  }, [showExpanded, draw]);

  const renderVisualizer = (
    ref: RefObject<HTMLDivElement | null>,
    className: string,
  ) => (
    <div className={className} ref={ref}>
      <canvas ref={canvasRef} className="audio-visualizer__canvas" aria-hidden />
      <Button
        variant="ghost"
        size="sm"
        iconOnly
        className="audio-visualizer__toggle"
        onClick={onToggleExpand}
        aria-label={expanded ? "Collapse visualizer" : "Expand visualizer"}
        aria-pressed={expanded}
      >
        <IconVisualizer />
      </Button>
    </div>
  );

  if (isMini) {
    return (
      <>
        {!showExpanded &&
          renderVisualizer(
            containerRef,
            "audio-visualizer audio-visualizer--mini",
          )}
        {showExpanded &&
          createPortal(
            renderVisualizer(
              expandedContainerRef,
              "audio-visualizer audio-visualizer--expanded",
            ),
            document.body,
          )}
      </>
    );
  }

  const dockClassName = expanded
    ? "audio-visualizer audio-visualizer--expanded"
    : "audio-visualizer";

  return renderVisualizer(containerRef, dockClassName);
}
