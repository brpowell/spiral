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
import {
  vizGifAssetUrl,
  vizImageAssetUrl,
  vizVideoAssetUrl,
} from "../../../lib/presentation/assets";
import { useSkinVisible } from "../../../lib/skinBinds";
import { Button } from "../../common/Button/Button";
import { IconMaximize, IconMinimize } from "../../icons";
import { useVisualizerContextBuilder } from "../context";
import { drawBarsFrame } from "../renderers/drawBars";
import { drawSpectrumFrame } from "../renderers/drawSpectrum";
import { drawWaveFrame } from "../renderers/drawWave";
import { WebGLLayerView } from "../webgl/WebGLLayerView";
import { isWebGLRendererId } from "../webgl/registry";
import "../renderers/audioVisualizer.css";
import {
  sampleFrequencyData,
  sampleTimeDomainData,
} from "../rendererUtils";
import type {
  RendererParams,
  VisualizerContext,
  VisualizerDrawArgs,
  VisualizerDrawState,
  VisualizerRendererId,
  VisualizerRendererProps,
} from "../types";
import { resolveLayerTransform } from "./resolveLayerTransform";
import type { LayoutRect, SceneLayer } from "./types";
import { resolveLayout } from "./types";
import "./SceneRenderer.css";

const DRAW_FNS: Record<
  VisualizerRendererId,
  (args: VisualizerDrawArgs, params: RendererParams) => void
> = {
  bars: drawBarsFrame,
  wave: drawWaveFrame,
  spectrum: drawSpectrumFrame,
};

export interface SceneRendererProps extends VisualizerRendererProps {
  scene: SceneLayer[];
  packDir?: string;
}

function layerAssetUrl(
  layer: SceneLayer,
  packDir: string,
): string | null {
  if (!layer.asset) return null;
  switch (layer.kind) {
    case "image":
      return vizImageAssetUrl(packDir, layer.asset);
    case "gif":
      return vizGifAssetUrl(packDir, layer.asset);
    case "video":
      return vizVideoAssetUrl(packDir, layer.asset);
    default:
      return null;
  }
}

function SceneLayerView({
  layer,
  rect,
  transform,
  packDir,
  context,
  drawState,
  remoteBins,
  remoteWaveform,
}: {
  layer: SceneLayer;
  rect: LayoutRect;
  transform: ReturnType<typeof resolveLayerTransform>;
  packDir?: string;
  context: VisualizerContext;
  drawState: VisualizerDrawState;
  remoteBins: number[] | null;
  remoteWaveform: number[] | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const visible = useSkinVisible(layer.visibleWhen);

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

  const drawCanvas = useCallback(() => {
    if (layer.kind !== "canvas" || !layer.renderer) return;
    const canvas = canvasRef.current;
    if (!canvas || rect.w <= 0 || rect.h <= 0) return;

    const dpr = window.devicePixelRatio || 1;
    const pixelW = Math.max(1, Math.floor(rect.w * dpr));
    const pixelH = Math.max(1, Math.floor(rect.h * dpr));

    if (canvas.width !== pixelW || canvas.height !== pixelH) {
      canvas.width = pixelW;
      canvas.height = pixelH;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const draw = DRAW_FNS[layer.renderer as VisualizerRendererId] ?? DRAW_FNS.bars;
    draw(
      {
        ctx,
        width: rect.w,
        height: rect.h,
        context,
        remoteBins,
        remoteWaveform,
        state: drawState,
      },
      (layer.params ?? {}) as RendererParams,
    );
  }, [context, drawState, layer, rect.h, rect.w, remoteBins, remoteWaveform]);

  useLayoutEffect(() => {
    if (layer.kind === "canvas") {
      drawCanvas();
    }
  }, [drawCanvas, layer.kind]);

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
            <SceneLayerView
              key={child.id ?? `${layer.id ?? "group"}-${index}`}
              layer={child}
              rect={childRect}
              transform={childTransform}
              packDir={packDir}
              context={context}
              drawState={drawState}
              remoteBins={remoteBins}
              remoteWaveform={remoteWaveform}
            />
          );
        })}
      </div>
    );
  }

  if (layer.kind === "canvas") {
    return (
      <div className="scene-layer" style={style}>
        <canvas
          ref={canvasRef}
          className="scene-layer__canvas"
          aria-hidden
        />
      </div>
    );
  }

  if (layer.kind === "webgl" && layer.renderer && isWebGLRendererId(layer.renderer)) {
    return (
      <WebGLLayerView
        rendererId={layer.renderer}
        params={layer.params}
        rect={rect}
        style={style}
        context={context}
        drawState={drawState}
        remoteBins={remoteBins}
      />
    );
  }

  if (!packDir || !layer.asset) return null;
  const src = layerAssetUrl(layer, packDir);
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
  surface,
  remoteFrameRef,
  useRemoteFrame,
}: {
  scene: SceneLayer[];
  packDir?: string;
  surface: VisualizerRendererProps["surface"];
  remoteFrameRef?: RefObject<VisualizerRemoteFrame | null>;
  useRemoteFrame: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const frequencyDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const timeDomainDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const idlePhaseRef = useRef(0);
  const [viewport, setViewport] = useState({ width: 0, height: 0, dpr: 1 });
  const buildContext = useVisualizerContextBuilder(surface);
  const remote = useRemoteFrame ? remoteFrameRef?.current : null;
  const remoteBins = remote?.bins ?? null;
  const remoteWaveform = remote?.waveform ?? null;

  const [frame, setFrame] = useState(0);

  useEffect(() => {
    let rafId = 0;
    const loop = () => {
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

  const context = useMemo(
    () => buildContext(viewport, bins),
    [buildContext, viewport, bins, frame],
  );

  const drawState: VisualizerDrawState = {
    idlePhaseRef,
    frequencyDataRef,
    timeDomainDataRef,
  };

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
          <SceneLayerView
            key={layer.id ?? `layer-${index}`}
            layer={layer}
            rect={rect}
            transform={transform}
            packDir={packDir}
            context={context}
            drawState={drawState}
            remoteBins={remoteBins}
            remoteWaveform={remoteWaveform}
          />
        );
      })}
    </div>
  );
}

export function SceneRenderer({
  scene,
  packDir,
  surface,
  variant = "dock",
  expanded,
  onToggleExpand,
  showExpandToggle = true,
  fillContainer = false,
  remoteFrameRef,
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
        surface={surface}
        remoteFrameRef={remoteFrameRef}
        useRemoteFrame={useRemoteFrame}
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
