import { resolveViewForPack } from "./skinViewState";
import { loadSkinPack } from "@/lib/tauri";
import { useSkinStore } from "@/store/useSkinStore";
import { getSkinAuxContext } from "@/lib/windows/windowRole";

export async function reloadActiveSkinPack(): Promise<void> {
  const { activeSkinId, activeViewId, packReloadGeneration } =
    useSkinStore.getState();
  const auxContext = getSkinAuxContext();
  const preferredViewId = auxContext?.viewId ?? activeViewId;

  const pack = await loadSkinPack(activeSkinId);
  const viewId = pack.manifest.views[preferredViewId]
    ? preferredViewId
    : resolveViewForPack(pack);

  useSkinStore.setState({
    activePack: pack,
    activeViewId: viewId,
    packReloadGeneration: packReloadGeneration + 1,
  });
}
