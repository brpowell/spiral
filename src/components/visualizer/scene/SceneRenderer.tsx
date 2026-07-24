import {
  useCallback,
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
import { useSkinVisible } from "../../../lib/skinBinds";
import type { VizRendererEngine } from "../../../types/renderer";
import { Button } from "../../common/Button/Button";
import { IconMaximize, IconMinimize } from "../../icons";
import { useVisualizerContextBuilder } from "../context";
import { SandboxedVizRenderer } from "../sandbox/SandboxedVizRenderer";
import "../audioVisualizer.css";
import {
  sampleFrequencyData,
  sampleTimeDomainData,
} from "../rendererUtils";
import type {
  VisualizerContext,
  VisualizerDrawState,
  VisualizerRendererProps,
} from "../types";
import {
  buildVizFrame,
  isRendererContributionId,
} from "../vizRendererApi";
import { resolveLayerTransform } from "./resolveLayerTransform";
import type { LayoutRect, VizScene, VizSceneLayer } from "./types";
import { resolveLayout } from "./types";
import "./SceneRenderer.css";

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
  packDir?: string;
  /**
   * When true, treat audio as playing for this host only (Appearance card
   * previews with synthetic demo frames while the player is paused).
   */
  previewForcePlaying?: boolean;
  /** Fires once after the first sandboxed layer has painted a frame. */
  onFirstFrame?: () => void;
}

function VizSceneLayerView({
  layer,
  rect,
  transform,
  packDir,
  context,
  drawState,
  remoteBins,
  remoteWaveform,
  elapsedMs,
  deltaMs,
  onFirstFrame,
}: {
  layer: VizSceneLayer;
  rect: LayoutRect;
  transform: ReturnType<typeof resolveLayerTransform>;
  packDir?: string;
  context: VisualizerContext;
  drawState: VisualizerDrawState;
  remoteBins: number[] | null;
  remoteWaveform: number[] | null;
  elapsedMs: number;
  deltaMs: number;
  onFirstFrame?: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sandboxRef = useRef<SandboxedVizRenderer | null>(null);
  const [sandboxEpoch, setSandboxEpoch] = useState(0);
  const [sandboxGeneration, setSandboxGeneration] = useState(0);
  const restartStateRef = useRef({ count: 0, windowStart: 0 });
  const visible = useSkinVisible(layer.visibleWhen);
  const dpr = context.size.dpr || window.devicePixelRatio || 1;
  const sizeReady = rect.w > 0 && rect.h > 0;
  const sandboxEngine = layerSandboxEngine(layer.kind);
  const onFirstFrameRef = useRef(onFirstFrame);
  onFirstFrameRef.current = onFirstFrame;

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
    if (!visible || !sizeReady) return;
    if (!isRendererContributionId(layer.renderer)) {
      console.error(
        `[visualizer] ${layer.kind} layer requires a renderer contribution id, got: ${layer.renderer ?? "(missing)"}`,
      );
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rendererId = layer.renderer;
    let cancelled = false;
    let sandbox: SandboxedVizRenderer | null = null;
    const abort = new AbortController();

    SandboxedVizRenderer.create({
      canvas,
      rendererId,
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
            `[visualizer] sandbox restart limit reached for ${rendererId}: ${reason}`,
          );
          return;
        }
        state.count += 1;
        console.warn(
          `[visualizer] restarting sandbox ${rendererId} (${state.count}/${SANDBOX_RESTART_LIMIT}): ${reason}`,
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
          `[visualizer] failed to sandbox renderer ${rendererId}`,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- boot once per renderer when sized
  }, [
    sandboxEngine,
    layer.kind,
    layer.renderer,
    sizeReady,
    visible,
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

    sandbox.postFrame(frame, layer.params ?? {});
  }, [
    sandboxEngine,
    context,
    deltaMs,
    drawState,
    elapsedMs,
    layer,
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

  if (!visible) return null;

  if (layer.kind === "group" && layer.children?.length) {
    return (
      <div className="scene-layer" style={style}>
        {layer.children.map((child, index) => {
          const childRect = resolveLayout(child.layout, rect.w, rect.h);
          const childTransform = resolveLayerTransform(child, {
            audio: context.audio,
            bind: context.bind,
          });
          return (
            <VizSceneLayerView
              key={child.id ?? `${layer.id ?? "group"}-${index}`}
              layer={child}
              rect={childRect}
              transform={childTransform}
              packDir={packDir}
              context={context}
              drawState={drawState}
              remoteBins={remoteBins}
              remoteWaveform={remoteWaveform}
              elapsedMs={elapsedMs}
              deltaMs={deltaMs}
              onFirstFrame={onFirstFrame}
            />
          );
        })}
      </div>
    );
  }

  if (sandboxEngine) {
    return (
      <div className="scene-layer" style={style}>
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
      <div className="scene-layer" style={style}>
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
    <div className="scene-layer" style={style}>
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
  packDir,
  remoteFrameRef,
  useRemoteFrame,
  previewForcePlaying = false,
  onFirstFrame,
}: {
  scene: VizScene;
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

  const [frame, setFrame] = useState(0);

  useEffect(() => {
    let rafId = 0;
    const loop = (now: number) => {
      const clock = frameClockRef.current;
      if (clock.start === 0) {
        clock.start = now;
        clock.last = now;
      }
      clock.deltaMs = Math.min(64, now - clock.last);
      clock.last = now;
      clock.elapsedMs = now - clock.start;

      if (!useRemoteFrame) {
        sampleTimeDomainData(timeDomainDataRef);
      }
      setFrame((f) => f + 1);
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [useRemoteFrame]);

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

  const sampled = sampleFrequencyData(frequencyDataRef, remoteBins);
  const bins: readonly number[] =
    !sampled
      ? []
      : Array.isArray(sampled)
        ? sampled
        : Array.from(sampled);

  const context = useMemo((): VisualizerContext => {
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
  }, [buildContext, viewport, bins, frame, previewForcePlaying]);

  const drawState: VisualizerDrawState = {
    timeDomainDataRef,
  };

  const { elapsedMs, deltaMs } = frameClockRef.current;

  if (viewport.width === 0 || viewport.height === 0) {
    return <div className="scene-viewport" ref={containerRef} />;
  }

  const driveContext = { audio: context.audio, bind: context.bind };

  return (
    <div className="scene-viewport" ref={containerRef}>
      {scene.map((layer, index) => {
        const rect = resolveLayout(layer.layout, viewport.width, viewport.height);
        const transform = resolveLayerTransform(layer, driveContext);
        return (
          <VizSceneLayerView
            key={layer.id ?? `layer-${index}`}
            layer={layer}
            rect={rect}
            transform={transform}
            packDir={packDir}
            context={context}
            drawState={drawState}
            remoteBins={remoteBins}
            remoteWaveform={remoteWaveform}
            elapsedMs={elapsedMs}
            deltaMs={deltaMs}
            onFirstFrame={notifyFirstFrame}
          />
        );
      })}
    </div>
  );
}

export function SceneRenderer({
  scene,
  packDir,
  variant = "dock",
  expanded,
  onToggleExpand,
  showExpandToggle = true,
  fillContainer = false,
  remoteFrameRef,
  previewForcePlaying = false,
  onFirstFrame,
}: SceneRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const expandedContainerRef = useRef<HTMLDivElement>(null);
  const isMini = variant === "mini";
  const showExpanded = isMini && expanded;
  const useRemoteFrame = remoteFrameRef !== undefined;

  const renderScene = (
    ref: RefObject<HTMLDivElement | null>,
    className: string,
  ) => (
    <div className={className} ref={ref}>
      <SceneViewport
        scene={scene}
        packDir={packDir}
        remoteFrameRef={remoteFrameRef}
        useRemoteFrame={useRemoteFrame}
        previewForcePlaying={previewForcePlaying}
        onFirstFrame={onFirstFrame}
      />
      {showExpandToggle ? (
        <Button
          variant="secondary"
          size="sm"
          iconOnly
          className="audio-visualizer__toggle"
          onClick={onToggleExpand}
          aria-label={expanded ? "Collapse visualizer" : "Expand visualizer"}
          aria-pressed={expanded}
        >
          {expanded ? <IconMinimize /> : <IconMaximize />}
        </Button>
      ) : null}
    </div>
  );

  if (isMini) {
    return (
      <>
        {!showExpanded &&
          renderScene(
            containerRef,
            "audio-visualizer audio-visualizer--mini",
          )}
        {showExpanded &&
          createPortal(
            renderScene(
              expandedContainerRef,
              "audio-visualizer audio-visualizer--expanded",
            ),
            document.body,
          )}
      </>
    );
  }

  const dockClassName = [
    "audio-visualizer",
    fillContainer ? "audio-visualizer--panel" : "",
    expanded ? "audio-visualizer--expanded" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return renderScene(containerRef, dockClassName);
}
