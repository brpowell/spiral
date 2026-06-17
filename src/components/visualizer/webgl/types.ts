import type { VisualizerContext, VisualizerDrawState } from "../types";
import type * as THREE from "three";

export interface WebGLRenderArgs {
  width: number;
  height: number;
  context: VisualizerContext;
  remoteBins: number[] | null;
  state: VisualizerDrawState;
}

export interface WebGLRendererHost {
  renderer: THREE.WebGLRenderer;
  width: number;
  height: number;
  dpr: number;
}

/** Lifecycle for a single WebGL scene renderer instance. */
export interface WebGLRendererModule {
  init(host: WebGLRendererHost): void;
  resize(width: number, height: number, dpr: number): void;
  render(
    args: WebGLRenderArgs,
    params: Record<string, unknown>,
    deltaMs: number,
  ): void;
  dispose(): void;
}
