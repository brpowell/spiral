import { getActiveSkinId, listSkins, loadSkinPack } from "./tauri";
import { restoreOpenSkinAuxWindows } from "./skinAuxWindow";
import { readOpenAuxViewsForSkin } from "./skinAuxViewState";
import { resolveViewForPack } from "./skinViewState";
import { applyPackWindowLayout } from "./skinModeWindowChrome";
import { installSkinDevConsole } from "./skinDevConsole";
import { isSkinModeVisible } from "./skinModeWindow";
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
    const openAuxiliaryViews = readOpenAuxViewsForSkin(resolvedId);

    useSkinStore.getState().initializeFromBootstrap(
      summaries,
      pack,
      resolvedId,
      viewId,
      openAuxiliaryViews,
    );

    if (isSkinModeWindow()) {
      installSkinDevConsole();
      await applyPackWindowLayout(pack, viewId);
      // Only restore auxiliary windows when skin mode is actually on screen.
      // At launch the skin-mode webview is created hidden (see tauri.conf.json),
      // so restoring here would spawn aux windows while the library view is
      // showing. openSkinMode() handles restoration once the window is shown.
      if (await isSkinModeVisible()) {
        await restoreOpenSkinAuxWindows(pack);
      }
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
