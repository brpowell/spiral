import { resolveDrive, type DriveContext } from "../../../lib/presentation/drives";
import type { TransformDriveKey } from "../../../lib/presentation/types";
import type { VizSceneLayer } from "./types";

export interface ResolvedLayerTransform {
  opacity: number;
  scale: number;
  translateX: number;
  translateY: number;
  rotation: number;
}

const TRANSFORM_DEFAULTS: ResolvedLayerTransform = {
  opacity: 1,
  scale: 1,
  translateX: 0,
  translateY: 0,
  rotation: 0,
};

const STATIC_KEYS: TransformDriveKey[] = [
  "opacity",
  "scale",
  "translateX",
  "translateY",
  "rotation",
];

export function resolveLayerTransform(
  layer: VizSceneLayer,
  context: DriveContext,
): ResolvedLayerTransform {
  const result = { ...TRANSFORM_DEFAULTS };

  for (const key of STATIC_KEYS) {
    const driven = resolveDrive(layer.drive?.[key], context);
    const staticValue = layer[key];
    result[key] = driven ?? staticValue ?? TRANSFORM_DEFAULTS[key];
  }

  return result;
}
