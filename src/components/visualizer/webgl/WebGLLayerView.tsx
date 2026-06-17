import {
  useEffect,
  useLayoutEffect,
  useRef,
  type CSSProperties,
} from "react";
import * as THREE from "three";
import { createWebGLRenderer } from "./registry";
import type { WebGLRendererHost, WebGLRendererModule } from "./types";
import type { VisualizerContext, VisualizerDrawState, WebGLRendererId } from "../types";
import type { LayoutRect } from "../scene/types";

export interface WebGLLayerViewProps {
  rendererId: WebGLRendererId;
  params?: Record<string, unknown>;
  rect: LayoutRect;
  style: CSSProperties;
  context: VisualizerContext;
  drawState: VisualizerDrawState;
  remoteBins: number[] | null;
}

export function WebGLLayerView({
  rendererId,
  params,
  rect,
  style,
  context,
  drawState,
  remoteBins,
}: WebGLLayerViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const moduleRef = useRef<WebGLRendererModule | null>(null);
  const hostRef = useRef<WebGLRendererHost | null>(null);
  const lastFrameRef = useRef(performance.now());

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const dpr = window.devicePixelRatio || 1;
    const webglRenderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    webglRenderer.setClearColor(0x000000, 0);
    webglRenderer.domElement.className = "scene-layer__webgl";
    container.appendChild(webglRenderer.domElement);

    const host: WebGLRendererHost = {
      renderer: webglRenderer,
      width: 0,
      height: 0,
      dpr,
    };
    hostRef.current = host;

    const module = createWebGLRenderer(rendererId);
    module.init(host);
    moduleRef.current = module;

    return () => {
      module.dispose();
      moduleRef.current = null;
      webglRenderer.dispose();
      webglRenderer.domElement.remove();
      hostRef.current = null;
    };
  }, [rendererId]);

  useLayoutEffect(() => {
    const module = moduleRef.current;
    const host = hostRef.current;
    if (!module || !host || rect.w <= 0 || rect.h <= 0) return;

    const dpr = window.devicePixelRatio || 1;
    if (host.width !== rect.w || host.height !== rect.h || host.dpr !== dpr) {
      module.resize(rect.w, rect.h, dpr);
    }

    const now = performance.now();
    const deltaMs = Math.min(now - lastFrameRef.current, 48);
    lastFrameRef.current = now;

    module.render(
      {
        width: rect.w,
        height: rect.h,
        context,
        remoteBins,
        state: drawState,
      },
      params ?? {},
      deltaMs,
    );
  }, [context, drawState, params, rect.h, rect.w, remoteBins]);

  return (
    <div className="scene-layer" style={style}>
      <div ref={containerRef} className="scene-layer__webgl-host" />
    </div>
  );
}
