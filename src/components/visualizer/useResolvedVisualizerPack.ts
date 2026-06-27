import { useEffect } from "react";
import { isAnySkinWindow } from "../../lib/windowRole";
import {
  DEFAULT_VISUALIZER_ID,
  resolveSkinVisualizerFixedPackId,
} from "../../lib/visualizerPack";
import { useSkinStore } from "../../store/useSkinStore";
import { useVisualizerStore } from "../../store/useVisualizerStore";
import { BARS_FALLBACK_PACK } from "./packs";
import type { VisualizerPack } from "./types";

export function useResolvedVisualizerPack(): VisualizerPack {
  const skinFixedPackId = useSkinStore((s) => {
    if (!isAnySkinWindow()) return null;
    return resolveSkinVisualizerFixedPackId(s.activePack?.manifest.visualizer);
  });
  const globalPackId = useVisualizerStore((s) => s.activePackId);
  const getPack = useVisualizerStore((s) => s.getPack);

  const effectiveId = skinFixedPackId ?? globalPackId ?? DEFAULT_VISUALIZER_ID;
  const pack = useVisualizerStore((s) => s.packCache[effectiveId]);

  useEffect(() => {
    if (useVisualizerStore.getState().packCache[effectiveId]) return;
    void getPack(effectiveId);
  }, [effectiveId, getPack]);

  return pack ?? BARS_FALLBACK_PACK;
}
