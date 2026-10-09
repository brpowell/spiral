import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import type { VisualizerRemoteFrame } from "../../../lib/visualizerDataBridge";
import { vizMediaLayerUrl } from "../../../lib/presentation/assets";
import { Button } from "../../common/Button/Button";
import { IconMaximize, IconMinimize } from "../../icons";
import { t } from "../../../lib/i18n";
import { useVisualizerContextBuilder } from "../context";
import { SandboxedVizRenderer } from "../sandbox/SandboxedVizRenderer";
import "../audioVisualizer.css";
import { sampleFrequencyData, sampleTimeDomainData } from "../rendererUtils";
import type {
  VisualizerContext,
  VisualizerDrawState,
  VisualizerRendererProps,
} from "../types";
import {
  buildVizFrame,
  isSafeVizEntry,
  type VizRendererEngine,
} from "../vizRendererApi";
import { resolveLayerTransform } from "./resolveLayerTransform";
import type { LayoutRect, VizScene, VizSceneLayer } from "./types";
import { resolveLayout } from "./types";
import {
  useAppBodyFrame,
  useVisualizerExpandMotion,
} from "./useVisualizerExpandMotion";
import "./SceneRenderer.css";

interface VizFrameSample {
  context: VisualizerContext;
  elapsedMs: number;
  deltaMs: number;
  waveform: number[] | null;
}

type VizFramePainter = (sample: VizFrameSample) => void;

const VizFrameSubscription = createContext<
  ((painter: VizFramePainter) => () => void) | null
>(null);

const EMPTY_BINS: readonly number[] = [];

function binsFromSample(
  sampled: Uint8Array<ArrayBuffer> | number[] | null,
  scratch: number[],
): readonly number[] {
  if (!sampled) return EMPTY_BINS;
  if (Array.isArray(sampled)) return sampled;
  if (scratch.length !== sampled.length) scratch.length = sampled.length;
  for (let i = 0; i < sampled.length; i++) scratch[i] = sampled[i] ?? 0;
  return scratch;
}

function layerSandboxEngine(
  kind: VizSceneLayer["kind"],
): VizRendererEngine | null {
  if (kind === "canvas") return "canvas2d";
  if (kind === "webgl") return "webgl";
  return null;
}

/** Caps auto-restarts after fatal sandbox terminates (e.g. lock-screen watchdog). */
const SANDBOX_RESTART_LIMIT = 3;
const SANDBOX_RESTART_WINDOW_MS = 30_000;

export interface SceneRendererProps extends VisualizerRendererProps {
  scene: VizScene;
  /** Effective visualizer contribution id (for loading layer entry scripts). */
  visualizerId: string;
  packDir?: string;
  /**
   * When true, treat audio as playing for this host only (Appearance card
   * previews with synthetic demo frames while the player is paused).
   */
  previewForcePlaying?: boolean;
  /** Fires once after the first sandboxed layer has painted a frame. */
  onFirstFrame?: () => void;
  /** Host paint (e.g. skin `style.backgroundColor`) — overrides theme `--color-bg`. */
  style?: CSSProperties;
}

function VizSceneLayerView({
  layer,
  rect,
  transform,
  visualizerId,
  packDir,
  context,
  drawState,
  remoteWaveform,
  elapsedMs,
  deltaMs,
  onFirstFrame,
}: {
  layer: VizSceneLayer;
  rect: LayoutRect;
  transform: ReturnType<typeof resolveLayerTransform>;
  visualizerId: string;
  packDir?: string;
  context: VisualizerContext;
  drawState: VisualizerDrawState;
  remoteWaveform: number[] | null;
  elapsedMs: number;
  deltaMs: number;
  onFirstFrame?: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const sandboxRef = useRef<SandboxedVizRenderer | null>(null);
  const [sandboxEpoch, setSandboxEpoch] = useState(0);
  const [sandboxGeneration, setSandboxGeneration] = useState(0);
  const restartStateRef = useRef({ count: 0, windowStart: 0 });
  const dpr = context.size.dpr || window.devicePixelRatio || 1;
  const sizeReady = rect.w > 0 && rect.h > 0;
  const sandboxEngine = layerSandboxEngine(layer.kind);
  const onFirstFrameRef = useRef(onFirstFrame);
  onFirstFrameRef.current = onFirstFrame;
  const subscribeFrame = useContext(VizFrameSubscription);
  const layerRef = useRef(layer);
  const rectRef = useRef(rect);
  const drawStateRef = useRef(drawState);
  layerRef.current = layer;
  rectRef.current = rect;
  drawStateRef.current = drawState;

  useEffect(() => {
    if (!subscribeFrame) return;
    return subscribeFrame((sample) => {
      const currentLayer = layerRef.current;
      const transformNow = resolveLayerTransform(currentLayer, {
        audio: sample.context.audio,
        bind: sample.context.bind,
      });
      const el = rootRef.current;
      if (el) {
        el.style.opacity = String(transformNow.opacity);
        el.style.transform = `translate(${transformNow.translateX}px, ${transformNow.translateY}px) scale(${transformNow.scale}) rotate(${transformNow.rotation}deg)`;
      }
      if (!sandboxEngine) return;
      const sandbox = sandboxRef.current;
      const box = rectRef.current;
      if (!sandbox?.ready || box.w <= 0 || box.h <= 0) return;
      sandbox.postFrame(
        buildVizFrame({
          context: sample.context,
          remoteWaveform: sample.waveform,
          timeDomainData: drawStateRef.current.timeDomainDataRef.current,
          elapsedMs: sample.elapsedMs,
          deltaMs: sample.deltaMs,
          width: box.w,
          height: box.h,
        }),
      );
    });
  }, [sandboxEngine, subscribeFrame]);

  const style = useMemo((): CSSProperties => {
    const base: CSSProperties = {
      left: rect.x,
      top: rect.y,
      width: rect.w,
      height: rect.h,
      opacity: transform.opacity,
      transform: `translate(${transform.translateX}px, ${transform.translateY}px) scale(${transform.scale}) rotate(${transform.rotation}deg)`,
    };
    if (layer.blend) {
      base.mixBlendMode = layer.blend as CSSProperties["mixBlendMode"];
    }
    return base;
  }, [layer.blend, rect, transform]);

  useEffect(() => {
    if (!sandboxEngine) return;
    if (!sizeReady) return;
    if (!isSafeVizEntry(layer.entry)) {
      console.error(
        `[visualizer] ${layer.kind} layer requires an entry .js filename, got: ${layer.entry ?? "(missing)"}`,
      );
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;

    const entry = layer.entry;
    const layerLabel = `${visualizerId}/${entry}`;
    let cancelled = false;
    let sandbox: SandboxedVizRenderer | null = null;
    const abort = new AbortController();

    SandboxedVizRenderer.create({
      canvas,
      visualizerId,
      entry,
      engine: sandboxEngine,
      width: rect.w,
      height: rect.h,
      dpr,
      onFirstFrame: () => {
        restartStateRef.current = { count: 0, windowStart: 0 };
        onFirstFrameRef.current?.();
      },
      onTerminated: (reason) => {
        if (cancelled) return;
        if (sandboxRef.current === sandbox) {
          sandboxRef.current = null;
        }

        const now = Date.now();
        const state = restartStateRef.current;
        if (now - state.windowStart > SANDBOX_RESTART_WINDOW_MS) {
          state.count = 0;
          state.windowStart = now;
        }
        if (state.count >= SANDBOX_RESTART_LIMIT) {
          console.error(
            `[visualizer] sandbox restart limit reached for ${layerLabel}: ${reason}`,
          );
          return;
        }
        state.count += 1;
        console.warn(
          `[visualizer] restarting sandbox ${layerLabel} (${state.count}/${SANDBOX_RESTART_LIMIT}): ${reason}`,
        );
        setSandboxGeneration((g) => g + 1);
      },
      signal: abort.signal,
    })
      .then((created) => {
        if (cancelled) {
          created.dispose();
          return;
        }
        sandbox = created;
        sandboxRef.current = created;
        setSandboxEpoch((n) => n + 1);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error(
          `[visualizer] failed to sandbox layer ${layerLabel}`,
          err,
        );
      });

    return () => {
      cancelled = true;
      abort.abort();
      if (sandboxRef.current === sandbox) {
        sandboxRef.current = null;
      }
    };
    // Intentionally omit rect/dpr: resize is handled below. sizeReady gates first boot.
    // sandboxGeneration remounts after fatal terminate (watchdog / context loss).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- boot once per layer entry when sized
  }, [
    sandboxEngine,
    layer.kind,
    layer.entry,
    visualizerId,
    sizeReady,
    sandboxGeneration,
  ]);

  useEffect(() => {
    if (!sandboxEngine) return;
    const sandbox = sandboxRef.current;
    if (!sandbox?.ready || !sizeReady) return;
    sandbox.resize(rect.w, rect.h, dpr);
  }, [sandboxEngine, rect.w, rect.h, dpr, sizeReady, sandboxEpoch]);

  const postSandboxFrame = useCallback(() => {
    if (!sandboxEngine) return;
    const sandbox = sandboxRef.current;
    if (!sandbox?.ready || !sizeReady) return;

    const frame = buildVizFrame({
      context,
      remoteWaveform,
      timeDomainData: drawState.timeDomainDataRef.current,
      elapsedMs,
      deltaMs,
      width: rect.w,
      height: rect.h,
    });

    sandbox.postFrame(frame);
    // sandboxEpoch intentionally busts this callback after sandbox restart so the
    // layout effect re-posts a frame; the body reads sandboxRef, not the epoch.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- epoch triggers re-post
  }, [
    sandboxEngine,
    context,
    deltaMs,
    drawState,
    elapsedMs,
    rect.h,
    rect.w,
    remoteWaveform,
    sandboxEpoch,
    sizeReady,
  ]);

  useLayoutEffect(() => {
    if (sandboxEngine) {
      postSandboxFrame();
    }
  }, [postSandboxFrame, sandboxEngine]);

  if (sandboxEngine) {
    return (
      <div ref={rootRef} className="scene-layer" style={style}>
        <canvas
          ref={canvasRef}
          className={
            layer.kind === "webgl"
              ? "scene-layer__webgl"
              : "scene-layer__canvas"
          }
          aria-hidden
        />
      </div>
    );
  }

  if (!packDir || !layer.asset) return null;
  const src = vizMediaLayerUrl(packDir, layer);
  if (!src) return null;

  if (layer.kind === "video") {
    return (
      <div ref={rootRef} className="scene-layer" style={style}>
        <video
          className="scene-layer__media"
          src={src}
          autoPlay
          loop={layer.loop !== false}
          muted
          playsInline
          aria-hidden
        />
      </div>
    );
  }

  return (
    <div ref={rootRef} className="scene-layer" style={style}>
      <img
        className="scene-layer__media"
        src={src}
        alt=""
        aria-hidden
        draggable={false}
      />
    </div>
  );
}

function SceneViewport({
  scene,
  visualizerId,
  packDir,
  remoteFrameRef,
  useRemoteFrame,
  previewForcePlaying = false,
  onFirstFrame,
}: {
  scene: VizScene;
  visualizerId: string;
  packDir?: string;
  remoteFrameRef?: RefObject<VisualizerRemoteFrame | null>;
  useRemoteFrame: boolean;
  previewForcePlaying?: boolean;
  onFirstFrame?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const frequencyDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const timeDomainDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const frameClockRef = useRef({ start: 0, last: 0, elapsedMs: 0, deltaMs: 0 });
  const [viewport, setViewport] = useState({ width: 0, height: 0, dpr: 1 });
  const buildContext = useVisualizerContextBuilder();
  const remote = useRemoteFrame ? remoteFrameRef?.current : null;
  const remoteBins = remote?.bins ?? null;
  const remoteWaveform = remote?.waveform ?? null;
  const firstFrameNotifiedRef = useRef(false);
  const onFirstFrameRef = useRef(onFirstFrame);
  onFirstFrameRef.current = onFirstFrame;

  const notifyFirstFrame = useCallback(() => {
    if (firstFrameNotifiedRef.current) return;
    firstFrameNotifiedRef.current = true;
    onFirstFrameRef.current?.();
  }, []);

  const paintersRef = useRef(new Set<VizFramePainter>());
  const subscribeFrame = useCallback((painter: VizFramePainter) => {
    paintersRef.current.add(painter);
    return () => {
      paintersRef.current.delete(painter);
    };
  }, []);
  const buildContextRef = useRef(buildContext);
  const viewportRef = useRef(viewport);
  const previewForcePlayingRef = useRef(previewForcePlaying);
  const useRemoteFrameRef = useRef(useRemoteFrame);
  const remoteFrameRefRef = useRef(remoteFrameRef);
  const binsScratchRef = useRef<number[]>([]);
  buildContextRef.current = buildContext;
  viewportRef.current = viewport;
  previewForcePlayingRef.current = previewForcePlaying;
  useRemoteFrameRef.current = useRemoteFrame;
  remoteFrameRefRef.current = remoteFrameRef;

  useEffect(() => {
    let rafId = 0;
    let stopped = false;

    const loop = (now: number) => {
      if (stopped) return;
      const clock = frameClockRef.current;
      if (clock.start === 0) {
        clock.start = now;
        clock.last = now;
      }
      clock.deltaMs = Math.min(64, now - clock.last);
      clock.last = now;
      clock.elapsedMs = now - clock.start;

      if (paintersRef.current.size > 0) {
        const remote = useRemoteFrameRef.current
          ? remoteFrameRefRef.current?.current
          : null;
        if (!remote) sampleTimeDomainData(timeDomainDataRef);
        const sampled = sampleFrequencyData(
          frequencyDataRef,
          remote?.bins ?? null,
        );
        let context = buildContextRef.current(
          viewportRef.current,
          binsFromSample(sampled, binsScratchRef.current),
        );
        if (previewForcePlayingRef.current) {
          context = {
            ...context,
            audio: {
              ...context.audio,
              isPlaying: true,
              playbackState: "playing",
            },
          };
        }
        const sample: VizFrameSample = {
          context,
          elapsedMs: clock.elapsedMs,
          deltaMs: clock.deltaMs,
          waveform: remote?.waveform ?? null,
        };
        for (const paint of paintersRef.current) paint(sample);
      }

      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => {
      stopped = true;
      cancelAnimationFrame(rafId);
    };
  }, []);

  const measure = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const width = el.clientWidth;
    const height = el.clientHeight;
    if (width === 0 || height === 0) return;
    const dpr = window.devicePixelRatio || 1;
    setViewport((prev) =>
      prev.width === width && prev.height === height && prev.dpr === dpr
        ? prev
        : { width, height, dpr },
    );
  }, []);

  useEffect(() => {
    measure();
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure]);

  const context = useMemo((): VisualizerContext => {
    const sampled = sampleFrequencyData(frequencyDataRef, remoteBins);
    const bins = binsFromSample(sampled, []);
    const base = buildContext(viewport, bins);
    if (!previewForcePlaying) return base;
    return {
      ...base,
      audio: {
        ...base.audio,
        isPlaying: true,
        playbackState: "playing",
      },
    };
  }, [buildContext, previewForcePlaying, remoteBins, viewport]);

  const drawState: VisualizerDrawState = {
    timeDomainDataRef,
  };

  const { elapsedMs, deltaMs } = frameClockRef.current;

  if (viewport.width === 0 || viewport.height === 0) {
    return <div className="scene-viewport" ref={containerRef} />;
  }

  const driveContext = { audio: context.audio, bind: context.bind };

  return (
    <VizFrameSubscription.Provider value={subscribeFrame}>
      <div className="scene-viewport" ref={containerRef}>
        {scene.map((layer, index) => {
          const rect = resolveLayout(
            layer.layout,
            viewport.width,
            viewport.height,
          );
          const transform = resolveLayerTransform(layer, driveContext);
          return (
            <VizSceneLayerView
              key={layer.id ?? `layer-${index}`}
              layer={layer}
              rect={rect}
              transform={transform}
              visualizerId={visualizerId}
              packDir={packDir}
              context={context}
              drawState={drawState}
              remoteWaveform={remoteWaveform}
              elapsedMs={elapsedMs}
              deltaMs={deltaMs}
              onFirstFrame={notifyFirstFrame}
            />
          );
        })}
      </div>
    </VizFrameSubscription.Provider>
  );
}

export function SceneRenderer({
  scene,
  visualizerId,
  packDir,
  variant = "dock",
  expanded = false,
  onToggleExpand,
  showExpandToggle = true,
  fillContainer = false,
  remoteFrameRef,
  previewForcePlaying = false,
  onFirstFrame,
  style,
}: SceneRendererProps) {
  const isMini = variant === "mini";
  const { stage, motion, onAnimationEnd } = useVisualizerExpandMotion(
    expanded,
    isMini,
  );
  const expandedFrame = useAppBodyFrame(isMini);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef(false);
  const useRemoteFrame = remoteFrameRef !== undefined;
  const moving = motion !== "idle";

  useLayoutEffect(() => {
    if (!restoreFocusRef.current) return;
    const toggle = toggleRef.current;
    if (!toggle) return;
    toggle.focus({ preventScroll: true });
    restoreFocusRef.current = false;
  }, [stage, expandedFrame, motion]);

  const shellClassName = [
    "audio-visualizer",
    isMini
      ? stage === "expanded"
        ? "audio-visualizer--expanded"
        : "audio-visualizer--mini"
      : fillContainer
        ? "audio-visualizer--panel"
        : "",
    isMini && motion === "recede" ? "audio-visualizer--recede" : "",
    isMini && motion === "emerge" ? "audio-visualizer--emerge" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const shell = (
    <div
      className={shellClassName}
      style={style}
      onAnimationEnd={isMini ? onAnimationEnd : undefined}
    >
      <div className="audio-visualizer__stage">
        <SceneViewport
          scene={scene}
          visualizerId={visualizerId}
          packDir={packDir}
          remoteFrameRef={remoteFrameRef}
          useRemoteFrame={useRemoteFrame}
          previewForcePlaying={previewForcePlaying}
          onFirstFrame={onFirstFrame}
        />
        {showExpandToggle && onToggleExpand ? (
          <Button
            ref={toggleRef}
            variant="secondary"
            size="sm"
            iconOnly
            className="audio-visualizer__toggle"
            onClick={(event) => {
              restoreFocusRef.current = event.detail === 0;
              onToggleExpand();
            }}
            aria-label={
              expanded
                ? t("playback:visualizer.collapse")
                : t("playback:visualizer.expand")
            }
            aria-pressed={expanded}
          >
            {expanded ? <IconMinimize /> : <IconMaximize />}
          </Button>
        ) : null}
      </div>
    </div>
  );

  if (!isMini) return shell;

  if (stage === "expanded") {
    if (!expandedFrame) return null;
    return createPortal(
      <div
        className={[
          "audio-visualizer-anchor",
          "audio-visualizer-anchor--expanded",
          moving ? "audio-visualizer-anchor--in-motion" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        style={{
          top: expandedFrame.top,
          left: expandedFrame.left,
          width: expandedFrame.width,
          height: expandedFrame.height,
        }}
      >
        {shell}
      </div>,
      document.body,
    );
  }

  return (
    <div
      className={[
        "audio-visualizer-anchor",
        moving ? "audio-visualizer-anchor--in-motion" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {shell}
    </div>
  );
}
