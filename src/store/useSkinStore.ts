import { create } from "zustand";
import { emit } from "@tauri-apps/api/event";
import { SKIN_CHANGED_EVENT, type SkinChangedPayload } from "../lib/skinBridge";
import {
  getActiveSkinId,
  listSkins,
  loadSkinPack,
  openSkinsFolder,
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
import {
  resolveViewForPack,
  writeViewForSkin,
} from "../lib/skinViewState";
import type { PanelOpenState } from "../lib/skinPanels";
import {
  panelMotionStateForView,
  runPanelClose,
  runPanelOpen,
  runPanelToggle,
  type PanelMotionState,
} from "../lib/skinPanelMotion";
import { SKIN_PLAYLIST_SOURCE_ALL } from "../lib/skinPlaylist";
import type { LoadedSkinPack, SkinSummary, SkinView } from "../types/skin";
import { isAppearanceWindow, isSkinModeWindow } from "../lib/windowRole";

export const DEFAULT_SKIN_ID = "spiral-default";

function motionStateForView(
  pack: LoadedSkinPack | null,
  viewId: string,
): PanelMotionState {
  const view = pack?.manifest.views[viewId];
  return view ? panelMotionStateForView(view) : { panelOpen: {}, panelRevealed: {}, panelSettled: {} };
}

interface SkinState extends PanelMotionState {
  skins: SkinSummary[];
  activePack: LoadedSkinPack | null;
  activeSkinId: string;
  activeViewId: string;
  /** View ids with open auxiliary windows for the active skin. */
  openAuxiliaryViews: string[];
  /** Active source for declarative skin playlist views (`all`, `upNext`, `playlist:{id}`). */
  playlistSourceId: string;
  /** Bumped on dev hot-reload so layout/stylesheet effects re-run for the same skin id. */
  packReloadGeneration: number;
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
  togglePanel: (panelId: string) => Promise<void>;
  openPanel: (panelId: string) => Promise<void>;
  closePanel: (panelId: string) => Promise<void>;
  resetPanelsForView: (view: SkinView) => void;
  setPlaylistSource: (sourceId: string) => void;
  openSkinsFolder: () => Promise<void>;
}

export const useSkinStore = create<SkinState>((set, get) => ({
  skins: [],
  activePack: null,
  activeSkinId: DEFAULT_SKIN_ID,
  activeViewId: "standard",
  openAuxiliaryViews: [],
  playlistSourceId: SKIN_PLAYLIST_SOURCE_ALL,
  packReloadGeneration: 0,
  panelOpen: {},
  panelRevealed: {},
  panelSettled: {},
  skinsLoaded: false,

  initializeFromBootstrap: (skins, pack, activeSkinId, activeViewId, openAuxiliaryViews) => {
    const motion = motionStateForView(pack, activeViewId);
    set({
      skins,
      activePack: pack,
      activeSkinId,
      activeViewId,
      openAuxiliaryViews:
        openAuxiliaryViews ?? readOpenAuxViewsForSkin(activeSkinId),
      ...motion,
      skinsLoaded: true,
    });
  },

  loadSkins: async () => {
    const summaries = await listSkins();
    const activeSkinId = await getActiveSkinId();
    const resolvedId = summaries.some((s) => s.id === activeSkinId)
      ? activeSkinId
      : DEFAULT_SKIN_ID;
    const pack = await loadSkinPack(resolvedId);
    const viewId = resolveViewForPack(pack);
    set({
      skins: summaries,
      activePack: pack,
      activeSkinId: resolvedId,
      activeViewId: viewId,
      openAuxiliaryViews: readOpenAuxViewsForSkin(resolvedId),
      ...motionStateForView(pack, viewId),
      skinsLoaded: true,
    });
  },

  setSkin: async (skinId) => {
    const { activePack: previousPack } = get();
    if (previousPack && previousPack.summary.id !== skinId) {
      await closeAllSkinAuxWindows(previousPack);
    }

    const pack = await loadSkinPack(skinId);
    const viewId = resolveViewForPack(pack);
    writeViewForSkin(skinId, viewId);
    set({
      activePack: pack,
      activeSkinId: skinId,
      activeViewId: viewId,
      openAuxiliaryViews: readOpenAuxViewsForSkin(skinId),
      playlistSourceId: SKIN_PLAYLIST_SOURCE_ALL,
      ...motionStateForView(pack, viewId),
    });
    await saveActiveSkinId(skinId);
    await saveActiveSkinView(viewId);

    if (isAppearanceWindow()) {
      await emit(SKIN_CHANGED_EVENT, { skinId, viewId } satisfies SkinChangedPayload);
    } else if (await isSkinModeVisible()) {
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
        ...motionStateForView(activePack, viewId),
      });
      await saveActiveSkinView(viewId);
      if (!growing) {
        void applySwitchViewWindowLayout(activePack, viewId).catch((err: unknown) => {
          console.error("Failed to resize skin window after view switch:", err);
        });
      }
      return;
    }

    set({
      activeViewId: viewId,
      playlistSourceId: SKIN_PLAYLIST_SOURCE_ALL,
      ...motionStateForView(activePack, viewId),
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

  resetPanelsForView: (view) => {
    set({
      ...panelMotionStateForView(view),
      playlistSourceId: SKIN_PLAYLIST_SOURCE_ALL,
    });
  },

  setPlaylistSource: (sourceId) => {
    set({ playlistSourceId: sourceId });
  },

  togglePanel: async (panelId) => {
    const { activePack, activeViewId, panelOpen, panelRevealed, panelSettled } = get();
    const view = activePack?.manifest.views[activeViewId];
    if (!activePack || !view?.panels?.[panelId]) return;

    const nextOpen = !(panelOpen[panelId] ?? false);
    await runPanelToggle(
      activePack,
      view,
      panelId,
      nextOpen,
      { panelOpen, panelRevealed, panelSettled },
      (patch) =>
        set((current) => ({
          panelOpen: patch.panelOpen ?? current.panelOpen,
          panelRevealed: patch.panelRevealed ?? current.panelRevealed,
          panelSettled: patch.panelSettled ?? current.panelSettled,
        })),
    );
  },

  openPanel: async (panelId) => {
    const { activePack, activeViewId, panelOpen, panelRevealed, panelSettled } = get();
    const view = activePack?.manifest.views[activeViewId];
    if (!activePack || !view?.panels?.[panelId]) return;

    await runPanelOpen(
      activePack,
      view,
      panelId,
      { panelOpen, panelRevealed, panelSettled },
      (patch) =>
        set((current) => ({
          panelOpen: patch.panelOpen ?? current.panelOpen,
          panelRevealed: patch.panelRevealed ?? current.panelRevealed,
          panelSettled: patch.panelSettled ?? current.panelSettled,
        })),
    );
  },

  closePanel: async (panelId) => {
    const { activePack, activeViewId, panelOpen, panelRevealed, panelSettled } = get();
    const view = activePack?.manifest.views[activeViewId];
    if (!activePack || !view?.panels?.[panelId]) return;

    await runPanelClose(
      activePack,
      view,
      panelId,
      { panelOpen, panelRevealed, panelSettled },
      (patch) =>
        set((current) => ({
          panelOpen: patch.panelOpen ?? current.panelOpen,
          panelRevealed: patch.panelRevealed ?? current.panelRevealed,
          panelSettled: patch.panelSettled ?? current.panelSettled,
        })),
    );
  },

  openSkinsFolder: async () => {
    await openSkinsFolder();
  },
}));

export type { PanelOpenState };
