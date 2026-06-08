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
import { applySkinChangeWindowLayout } from "../lib/skinModeWindowChrome";
import { isSkinModeVisible } from "../lib/skinModeWindow";
import { isSkinPickerWindow } from "../lib/windowRole";
import {
  resolveViewForPack,
  writeViewForSkin,
} from "../lib/skinViewState";
import type { LoadedSkinPack, SkinSummary } from "../types/skin";

export const DEFAULT_SKIN_ID = "spiral-default";

interface SkinState {
  skins: SkinSummary[];
  activePack: LoadedSkinPack | null;
  activeSkinId: string;
  activeViewId: string;
  skinsLoaded: boolean;
  loadSkins: () => Promise<void>;
  initializeFromBootstrap: (
    skins: SkinSummary[],
    pack: LoadedSkinPack,
    activeSkinId: string,
    activeViewId: string,
  ) => void;
  setSkin: (skinId: string) => Promise<void>;
  setView: (viewId: string) => Promise<void>;
  openSkinsFolder: () => Promise<void>;
}

export const useSkinStore = create<SkinState>((set, get) => ({
  skins: [],
  activePack: null,
  activeSkinId: DEFAULT_SKIN_ID,
  activeViewId: "standard",
  skinsLoaded: false,

  initializeFromBootstrap: (skins, pack, activeSkinId, activeViewId) => {
    set({
      skins,
      activePack: pack,
      activeSkinId,
      activeViewId,
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
      skinsLoaded: true,
    });
  },

  setSkin: async (skinId) => {
    const pack = await loadSkinPack(skinId);
    const viewId = resolveViewForPack(pack);
    writeViewForSkin(skinId, viewId);
    set({
      activePack: pack,
      activeSkinId: skinId,
      activeViewId: viewId,
    });
    await saveActiveSkinId(skinId);
    await saveActiveSkinView(viewId);

    if (isSkinPickerWindow()) {
      await emit(SKIN_CHANGED_EVENT, { skinId, viewId } satisfies SkinChangedPayload);
    } else if (await isSkinModeVisible()) {
      await applySkinChangeWindowLayout(pack);
    }
  },

  setView: async (viewId) => {
    const { activePack, activeSkinId } = get();
    if (!activePack || !activePack.manifest.views[viewId]) return;
    writeViewForSkin(activeSkinId, viewId);
    set({ activeViewId: viewId });
    await saveActiveSkinView(viewId);
  },

  openSkinsFolder: async () => {
    await openSkinsFolder();
  },
}));
