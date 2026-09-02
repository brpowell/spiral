import { spreadLinearBands } from "./equalizer/spread";
import { walkLayoutTree } from "./skinLayout";
import { useEqualizerStore } from "../store/useEqualizerStore";
import type { LoadedSkinPack, SliderEqNode } from "../types/skin";

function collectLinearEqSpreadBands(pack: LoadedSkinPack): number[] {
  const bands = new Set<number>();
  for (const view of Object.values(pack.manifest.views)) {
    for (const { node } of walkLayoutTree(view.layout)) {
      if (
        node.type === "slider" &&
        node.control === "eq" &&
        node.spread === "linear"
      ) {
        bands.add(node.band);
      }
    }
  }
  return [...bands].sort((a, b) => a - b);
}

/** Write one EQ slider, interpolating a linear tilt when `spread` is set. */
export function applyEqBandSliderGain(
  node: SliderEqNode,
  pack: LoadedSkinPack,
  gainDb: number,
): void {
  const { setBand, setBands, bands } = useEqualizerStore.getState();
  const controlBands =
    node.spread === "linear" ? collectLinearEqSpreadBands(pack) : [];
  if (controlBands.length < 2) {
    setBand(node.band - 1, gainDb);
    return;
  }
  setBands(spreadLinearBands(bands, controlBands, node.band, gainDb));
}
