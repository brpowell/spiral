import { getActiveSkinId, listSkins, loadSkinPack } from "./tauri";
import { resolveViewForPack } from "./skinViewState";
import { applyPackWindowLayout } from "./skinModeWindowChrome";
import { DEFAULT_SKIN_ID, useSkinStore } from "../store/useSkinStore";
import { isSkinModeWindow } from "./windowRole";

export async function bootstrapSkin(): Promise<void> {
  try {
    const [summaries, activeSkinId] = await Promise.all([
      listSkins(),
      getActiveSkinId(),
    ]);

    const resolvedId = summaries.some((s) => s.id === activeSkinId)
      ? activeSkinId
      : DEFAULT_SKIN_ID;

    const pack = await loadSkinPack(resolvedId);
    const viewId = resolveViewForPack(pack);

    useSkinStore
      .getState()
      .initializeFromBootstrap(summaries, pack, resolvedId, viewId);

    if (await isSkinModeWindow()) {
      await applyPackWindowLayout(pack);
    }
  } catch (err) {
    console.error("Skin bootstrap failed:", err);
    useSkinStore.getState().initializeFromBootstrap(
      [],
      {
        summary: {
          id: DEFAULT_SKIN_ID,
          name: "Spiral Default",
          author: "Spiral",
          description: "",
          isBuiltin: true,
          previewPath: null,
        },
        packDir: "",
        manifest: {
          version: 1,
          name: "Spiral Default",
          author: "Spiral",
          description: "",
          defaultView: "standard",
          views: {
            standard: {
              layout: { type: "column", children: [] },
            },
          },
        },
      },
      DEFAULT_SKIN_ID,
      "standard",
    );
  }
}
