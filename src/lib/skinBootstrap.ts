import { getSkinBootstrap, loadSkinPack } from "./tauri";
import { restoreOpenSkinAuxWindows } from "./skinAuxWindow";
import { readOpenAuxViewsForSkin } from "./skinAuxViewState";
import { resolveViewForPack } from "./skinViewState";
import { applyPackWindowLayout } from "./skinModeWindowChrome";
import { installSkinDevConsole } from "./skinDevConsole";
import { isSkinModeVisible } from "./skinModeWindow";
import { DEFAULT_SKIN_ID, useSkinStore } from "../store/useSkinStore";
import { useSkinPreferencesStore } from "../store/useSkinPreferencesStore";
import { isSkinModeWindow } from "./windowRole";

export async function bootstrapSkin(): Promise<void> {
  try {
    const boot = await getSkinBootstrap();
    const resolvedId = boot.summaries.some((s) => s.id === boot.activeSkinId)
      ? boot.activeSkinId
      : DEFAULT_SKIN_ID;
    const pack =
      resolvedId === boot.activeSkinId
        ? boot.pack
        : await loadSkinPack(resolvedId);
    const viewId = resolveViewForPack(pack);
    const openAuxiliaryViews = readOpenAuxViewsForSkin(resolvedId);

    useSkinStore
      .getState()
      .initializeFromBootstrap(
        boot.summaries,
        pack,
        resolvedId,
        viewId,
        openAuxiliaryViews,
      );
    await useSkinPreferencesStore.getState().loadForSkin(resolvedId);

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
          packId: "core",
          packName: "Core",
          packVersion: "1.0.0",
          zone: "builtin",
          previewPath: null,
        },
        packDir: "",
        manifest: {
          id: "vanilla",
          name: "Spiral Default",
          author: "Spiral",
          description: "",
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
