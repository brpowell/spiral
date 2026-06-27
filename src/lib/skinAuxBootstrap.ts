import { loadSkinPack } from "./tauri";
import { applySkinAuxViewWindowLayout } from "./skinAuxWindow";
import { readOpenAuxViewsForSkin } from "./skinAuxViewState";
import { installSkinDevConsole } from "./skinDevConsole";
import { DEFAULT_SKIN_ID, useSkinStore } from "../store/useSkinStore";
import { useSkinPreferencesStore } from "../store/useSkinPreferencesStore";
import { getSkinAuxContext } from "./windowRole";

/** Minimal startup for auxiliary skin windows (eq, playlist, etc.). */
export async function bootstrapSkinAux(): Promise<void> {
  const auxContext = getSkinAuxContext();
  if (!auxContext) {
    throw new Error("bootstrapSkinAux requires skin aux context");
  }

  try {
    const { skinId, viewId } = auxContext;
    const pack = await loadSkinPack(skinId);

    useSkinStore.getState().initializeFromBootstrap(
      [pack.summary],
      pack,
      skinId,
      viewId,
      readOpenAuxViewsForSkin(skinId),
    );
    await useSkinPreferencesStore.getState().loadForSkin(skinId);

    installSkinDevConsole();
    await applySkinAuxViewWindowLayout(pack, viewId);
  } catch (err) {
    console.error("Skin aux bootstrap failed:", err);
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
      auxContext.viewId,
    );
  }
}

