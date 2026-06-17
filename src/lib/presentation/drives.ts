import type { SkinBindPath } from "../../types/skin";
import type { VisualizerContext } from "../../components/visualizer/types";
import type { DriveBinding } from "./types";

export interface DriveContext {
  audio: VisualizerContext["audio"];
  bind: (path: SkinBindPath) => string | number | boolean | null;
}

function lerpMap(
  value: number,
  [inMin, inMax, outMin, outMax]: [number, number, number, number],
): number {
  const span = inMax - inMin;
  const t = span === 0 ? 0 : Math.max(0, Math.min(1, (value - inMin) / span));
  return outMin + t * (outMax - outMin);
}

function readAudioSource(
  source: string,
  audio: DriveContext["audio"],
): number {
  if (!source.startsWith("audio.")) return 0;
  const key = source.slice("audio.".length);
  switch (key) {
    case "overallEnergy":
      return audio.overallEnergy;
    case "bassEnergy":
      return audio.bassEnergy;
    case "midEnergy":
      return audio.midEnergy;
    case "trebleEnergy":
      return audio.trebleEnergy;
    case "volume":
      return audio.volume;
    default:
      return 0;
  }
}

function readBindSource(
  source: string,
  bind: DriveContext["bind"],
): number {
  const value = bind(source as SkinBindPath);
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string") return value.length > 0 ? 1 : 0;
  return 0;
}

/** Resolve a drive binding to a numeric value for transform properties. */
export function resolveDrive(
  binding: DriveBinding | undefined,
  context: DriveContext,
): number | undefined {
  if (binding === undefined) return undefined;
  if (typeof binding === "number") return binding;

  if (typeof binding === "string") {
    const raw = binding.startsWith("audio.")
      ? readAudioSource(binding, context.audio)
      : readBindSource(binding, context.bind);
    return raw;
  }

  if (binding.value !== undefined) return binding.value;

  const source = binding.drive;
  const raw = source.startsWith("audio.")
    ? readAudioSource(source, context.audio)
    : readBindSource(source, context.bind);

  if (binding.map) {
    return lerpMap(raw, binding.map);
  }
  return raw;
}
