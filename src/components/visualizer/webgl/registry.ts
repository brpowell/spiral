import type { WebGLRendererId } from "../types";
import type { WebGLRendererModule } from "./types";
import { createNeonTunnelRenderer } from "./renderers/neonTunnel";

const WEBGL_RENDERERS: Record<WebGLRendererId, () => WebGLRendererModule> = {
  "neon-tunnel": createNeonTunnelRenderer,
};

export function createWebGLRenderer(id: WebGLRendererId): WebGLRendererModule {
  const factory = WEBGL_RENDERERS[id];
  if (!factory) {
    throw new Error(`Unknown WebGL renderer: ${id}`);
  }
  return factory();
}

export function isWebGLRendererId(
  value: string | undefined,
): value is WebGLRendererId {
  return value !== undefined && value in WEBGL_RENDERERS;
}
