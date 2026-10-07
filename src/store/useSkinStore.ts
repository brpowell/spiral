import { create } from "zustand";
import { emit } from "@tauri-apps/api/event";
import { SKIN_CHANGED_EVENT, type SkinChangedPayload } from "../lib/skinBridge";
import {
  getSkinBootstrap,
  loadSkinPack,
  saveActiveSkinId,
  saveActiveSkinView,
} from "../lib/tauri";
import {
  applySkinChangeWindowLayout,
  applySwitchViewWindowLayout,
} from "../lib/skinModeWindowChrome";
import {
  closeAllSkinAuxWindows,
  closeSkinAuxWindow,
  isSkinAuxViewOpen,
  openSkinAuxWindow,
  restoreOpenSkinAuxWindows,
} from "../lib/skinAuxWindow";
import {
  readOpenAuxViewsForSkin,
  removeOpenAuxView,
} from "../lib/skinAuxViewState";
import { isSkinModeVisible } from "../lib/skinModeWindow";
import {
  canSwitchView,
  isAuxiliaryView,
  viewWindowGrows,
  viewWindowSizeChanged,
} from "../lib/skinWindowPresentation";
import { resolveViewForPack, writeViewForSkin } from "../lib/skinViewState";
import { SKIN_PLAYLIST_SOURCE_ALL } from "../lib/skinPlaylist";
import { preloadSkinStylesheet } from "../lib/skinStylesheetCache";
import { preloadSkinSwitchAssets } from "../lib/skinViewAssetPreload";
import type { LoadedSkinPack, SkinSummary } from "../types/skin";
import { isAppearanceWindow, isSkinModeWindow } from "../lib/windowRole";
import { useSkinPreferencesStore } from "./useSkinPreferencesStore";

export const DEFAULT_SKIN_ID = "spiral.core.skin.vanilla";

/** Bumped so an older in-flight load/switch cannot commit after a newer one. */
let skinCommitGeneration = 0;

function waitAnimationFrames(count: number): Promise<void> {
  return new Promise((resolve) => {
    const step = (remaining: number) => {
      if (remaining <= 0) {
        resolve();
        return;
      }
      requestAnimationFrame(() => step(remaining - 1));
    };
    step(count);
  });
}

async function preloadSkinModePack(
  pack: LoadedSkinPack,
  viewId: string,
  packReloadGeneration: number,
): Promise<void> {
  await Promise.all([
    preloadSkinSwitchAssets(pack, viewId),
    preloadSkinStylesheet(pack, packReloadGeneration),
  ]);
}

/** Hide → preload → resize → commit → show (avoids painting at the wrong window size). */
async function commitSkinModeSwitch(
  set: (partial: Partial<SkinState>) => void,
  get: () => SkinState,
  options: {
    commitGeneration: number;
    pack: LoadedSkinPack;
    viewId: string;
    patch: Partial<SkinState>;
  },
): Promise<boolean> {
  const { commitGeneration, pack, viewId, patch } = options;
  const isStale = () => commitGeneration !== skinCommitGeneration;

  set({ skinSwapPending: true });
  // Let React apply visibility:hidden before the window resizes.
  await waitAnimationFrames(1);

  await preloadSkinModePack(pack, viewId, get().packReloadGeneration);
  if (isStale()) {
    set({ skinSwapPending: false });
    return false;
  }

  if (await isSkinModeVisible()) {
    await applySkinChangeWindowLayout(pack, viewId);
  }
  if (isStale()) {
    set({ skinSwapPending: false });
    return false;
  }

  set(patch);

  await waitAnimationFrames(2);
  if (isStale()) {
    set({ skinSwapPending: false });
    return false;
  }

  set({ skinSwapPending: false });

  if (await isSkinModeVisible()) {
    await restoreOpenSkinAuxWindows(pack);
  }
  return true;
}

interface SkinState {
  skins: SkinSummary[];
  activePack: LoadedSkinPack | null;
  activeSkinId: string;
  activeViewId: string;
  /** View ids with open auxiliary windows for the active skin. */
  openAuxiliaryViews: string[];
  /** Active source for declarative skin playlist views (`all`, `upNext`, `playlist:{id}`). */
  playlistSourceId: string;
  /** Active playlist filter query from `playlist.setFilter`. */
  playlistFilterQuery: string;
  /** Live values for `type: "input"` nodes, keyed by node id. */
  inputValues: Record<string, string>;
  /** Bumped on dev hot-reload so layout/stylesheet effects re-run for the same skin id. */
  packReloadGeneration: number;
  /** True while a skin-mode switch veil is up. */
  skinSwapPending: boolean;
  skinsLoaded: boolean;
  loadSkins: () => Promise<void>;
  initializeFromBootstrap: (
    skins: SkinSummary[],
    pack: LoadedSkinPack,
    activeSkinId: string,
    activeViewId: string,
    openAuxiliaryViews?: string[],
  ) => void;
  setSkin: (skinId: string) => Promise<void>;
  setView: (viewId: string) => Promise<void>;
  switchView: (viewId: string) => Promise<void>;
  openView: (viewId: string) => Promise<void>;
  closeView: (viewId: string) => Promise<void>;
  toggleView: (viewId: string) => Promise<void>;
  setPlaylistSource: (sourceId: string) => void;
  setPlaylistFilter: (query: string) => void;
  setInputValue: (id: string, value: string) => void;
}

export const useSkinStore = create<SkinState>((set, get) => ({
  skins: [],
  activePack: null,
  activeSkinId: DEFAULT_SKIN_ID,
  activeViewId: "standard",
  openAuxiliaryViews: [],
  playlistSourceId: SKIN_PLAYLIST_SOURCE_ALL,
  playlistFilterQuery: "",
  inputValues: {},
  packReloadGeneration: 0,
  skinSwapPending: false,
  skinsLoaded: false,

  initializeFromBootstrap: (
    skins,
    pack,
    activeSkinId,
    activeViewId,
    openAuxiliaryViews,
  ) => {
    set({
      skins,
      activePack: pack,
      activeSkinId,
      activeViewId,
      openAuxiliaryViews:
        openAuxiliaryViews ?? readOpenAuxViewsForSkin(activeSkinId),
      skinsLoaded: true,
    });
  },

  loadSkins: async () => {
    const commitGeneration = ++skinCommitGeneration;
    const boot = await getSkinBootstrap();
    const resolvedId = boot.summaries.some((s) => s.id === boot.activeSkinId)
      ? boot.activeSkinId
      : DEFAULT_SKIN_ID;
    const pack =
      resolvedId === boot.activeSkinId
        ? boot.pack
        : await loadSkinPack(resolvedId);
    const viewId = resolveViewForPack(pack);
    const previousId = get().activePack?.summary.id;
    const isSkinSwitch =
      isSkinModeWindow() && previousId != null && previousId !== resolvedId;

    const patch = {
      skins: boot.summaries,
      activePack: pack,
      activeSkinId: resolvedId,
      activeViewId: viewId,
      openAuxiliaryViews: readOpenAuxViewsForSkin(resolvedId),
      skinsLoaded: true,
    };

    if (isSkinSwitch) {
      const committed = await commitSkinModeSwitch(set, get, {
        commitGeneration,
        pack,
        viewId,
        patch,
      });
      if (!committed) return;
    } else {
      if (isSkinModeWindow()) {
        await preloadSkinModePack(pack, viewId, get().packReloadGeneration);
      }
      if (commitGeneration !== skinCommitGeneration) return;
      set(patch);
    }

    await useSkinPreferencesStore.getState().loadForSkin(resolvedId);
  },

  setSkin: async (skinId) => {
    const commitGeneration = ++skinCommitGeneration;
    const { activePack: previousPack } = get();
    if (previousPack && previousPack.summary.id !== skinId) {
      await closeAllSkinAuxWindows(previousPack);
    }

    const pack = await loadSkinPack(skinId);
    const viewId = resolveViewForPack(pack);
    writeViewForSkin(skinId, viewId);

    const patch = {
      activePack: pack,
      activeSkinId: skinId,
      activeViewId: viewId,
      openAuxiliaryViews: readOpenAuxViewsForSkin(skinId),
      playlistSourceId: SKIN_PLAYLIST_SOURCE_ALL,
      playlistFilterQuery: "",
      inputValues: {},
    };

    const isSkinSwitch =
      isSkinModeWindow() &&
      previousPack != null &&
      previousPack.summary.id !== skinId;

    if (isSkinSwitch) {
      const committed = await commitSkinModeSwitch(set, get, {
        commitGeneration,
        pack,
        viewId,
        patch,
      });
      if (!committed) return;
    } else {
      if (isSkinModeWindow()) {
        await preloadSkinModePack(pack, viewId, get().packReloadGeneration);
      }
      if (commitGeneration !== skinCommitGeneration) return;
      set(patch);
    }

    await saveActiveSkinId(skinId);
    await saveActiveSkinView(viewId);
    await useSkinPreferencesStore.getState().loadForSkin(skinId);

    if (isAppearanceWindow()) {
      await emit(SKIN_CHANGED_EVENT, {
        skinId,
        viewId,
      } satisfies SkinChangedPayload);
    } else if (
      isSkinModeWindow() &&
      !isSkinSwitch &&
      (await isSkinModeVisible())
    ) {
      await applySkinChangeWindowLayout(pack, viewId);
      await restoreOpenSkinAuxWindows(pack);
    }
  },

  setView: async (viewId) => {
    const { activePack, activeSkinId, activeViewId } = get();
    if (!activePack || !activePack.manifest.views[viewId]) return;

    writeViewForSkin(activeSkinId, viewId);

    const needsSizedSwitch =
      isSkinModeWindow() &&
      activeViewId !== viewId &&
      viewWindowSizeChanged(activePack, activeViewId, viewId);

    if (needsSizedSwitch) {
      const growing = viewWindowGrows(activePack, activeViewId, viewId);
      if (growing) {
        await applySwitchViewWindowLayout(activePack, viewId);
      }
      set({
        activeViewId: viewId,
        playlistSourceId: SKIN_PLAYLIST_SOURCE_ALL,
        playlistFilterQuery: "",
        inputValues: {},
      });
      await saveActiveSkinView(viewId);
      if (!growing) {
        void applySwitchViewWindowLayout(activePack, viewId).catch(
          (err: unknown) => {
            console.error(
              "Failed to resize skin window after view switch:",
              err,
            );
          },
        );
      }
      return;
    }

    set({
      activeViewId: viewId,
      playlistSourceId: SKIN_PLAYLIST_SOURCE_ALL,
      playlistFilterQuery: "",
      inputValues: {},
    });
    await saveActiveSkinView(viewId);

    if (isSkinModeWindow()) {
      await applySwitchViewWindowLayout(activePack, viewId);
    }
  },

  switchView: async (viewId) => {
    const { activePack } = get();
    if (!activePack || !canSwitchView(activePack, viewId)) return;
    await get().setView(viewId);
  },

  openView: async (viewId) => {
    const { activePack, activeSkinId } = get();
    if (!activePack || !isAuxiliaryView(activePack, viewId)) return;

    await openSkinAuxWindow(activePack, viewId);
    set({
      openAuxiliaryViews: readOpenAuxViewsForSkin(activeSkinId),
    });
  },

  closeView: async (viewId) => {
    const { activePack, activeSkinId } = get();
    if (!activePack) return;

    removeOpenAuxView(activeSkinId, viewId);
    set({
      openAuxiliaryViews: readOpenAuxViewsForSkin(activeSkinId),
    });

    try {
      await closeSkinAuxWindow(activePack, viewId);
    } finally {
      set({
        openAuxiliaryViews: readOpenAuxViewsForSkin(activeSkinId),
      });
    }
  },

  toggleView: async (viewId) => {
    const { activePack, activeSkinId } = get();
    if (!activePack) return;

    const isOpen = await isSkinAuxViewOpen(activeSkinId, viewId);
    if (isOpen) {
      await get().closeView(viewId);
    } else {
      await get().openView(viewId);
    }
  },

  setPlaylistSource: (sourceId) => {
    set({ playlistSourceId: sourceId });
  },

  setPlaylistFilter: (query) => {
    set({ playlistFilterQuery: query });
  },

  setInputValue: (id, value) => {
    if (!id) return;
    set((state) => ({
      inputValues: { ...state.inputValues, [id]: value },
    }));
  },
}));
