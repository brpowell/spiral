import React from "react";
import ReactDOM from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import App from "./App";
import { ActivityLogsApp } from "./ActivityLogsApp";
import { AppearanceApp } from "./AppearanceApp";
import { EqualizerApp } from "./EqualizerApp";
import { SkinModeApp } from "./SkinModeApp";
import { initPlayerStoreBridge } from "./lib/playerStoreBridge";
import { initSkinBridge } from "./lib/skinBridge";
import { initThemeBridge } from "./lib/themeBridge";
import { initVisualizerBridge } from "./lib/visualizerBridge";
import { initEqBridge } from "./lib/eqBridge";
import { bootstrapSkin } from "./lib/skinBootstrap";
import { bootstrapSkinAux } from "./lib/skinAuxBootstrap";
import { emitSkinAuxReady } from "./lib/skinAuxEvents";
import { preloadSkinSwitchAssets, preloadSkinViewAssets } from "./lib/skinViewAssetPreload";
import { resolveAuxStartupRequirements } from "./lib/skinAuxStartupRequirements";
import { usePlaylistStore } from "./store/usePlaylistStore";
import { useSkinStore } from "./store/useSkinStore";
import { bootstrapTheme } from "./lib/themeBootstrap";
import { bootstrapVisualizer } from "./lib/visualizerBootstrap";
import { bootstrapEqualizer } from "./lib/equalizerBootstrap";
import { bootstrapPlaybackSettings } from "./lib/playbackSettingsBootstrap";
import {
  initCrashHandlers,
  installCrashDevConsole,
} from "./lib/crashReport";
import {
  bootstrapWindowRole,
  getSkinAuxContext,
  isActivityLogsWindow,
  isAppearanceWindow,
  isEqualizerWindow,
  isAnySkinWindow,
  isSkinAuxWindow,
  isSkinModeWindow,
} from "./lib/windowRole";
import { applyCustomWindowChrome } from "./lib/windowChrome";
import { i18n } from "./lib/i18n";
import "./styles/theme.css";
import "./styles/scrollbars.css";

const root = document.getElementById("root") as HTMLElement;

function renderRoot(node: React.ReactNode) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <I18nextProvider i18n={i18n}>{node}</I18nextProvider>
    </React.StrictMode>,
  );
}

async function start() {
  initCrashHandlers();
  installCrashDevConsole();

  const role = await bootstrapWindowRole();

  // Library + secondary utility windows (not skins — already frameless).
  if (
    role === "main" ||
    role === "appearance" ||
    role === "equalizer" ||
    role === "activity-logs"
  ) {
    await applyCustomWindowChrome();
  }

  if (isActivityLogsWindow()) {
    await bootstrapTheme();
    await initThemeBridge(role);

    renderRoot(<ActivityLogsApp />);
    return;
  }

  if (isEqualizerWindow()) {
    await bootstrapEqualizer();
    await initEqBridge(role);

    renderRoot(<EqualizerApp />);
    return;
  }

  if (isSkinAuxWindow()) {
    await bootstrapSkinAux();
    const auxContext = getSkinAuxContext();
    const activePack = useSkinStore.getState().activePack;
    const needs =
      activePack && auxContext
        ? resolveAuxStartupRequirements(activePack, auxContext.viewId)
        : null;

    if (needs?.theme) {
      await bootstrapTheme();
      await initThemeBridge(role);
    }
    if (needs?.visualizer) {
      await bootstrapVisualizer();
      await initVisualizerBridge(role);
    }
    if (activePack && auxContext) {
      await preloadSkinViewAssets(activePack, auxContext.viewId);
    }
    await initPlayerStoreBridge(role);
    if (!needs || needs.eq) {
      await initEqBridge(role);
    }
    if (needs?.playlists) {
      await usePlaylistStore.getState().loadPlaylists();
    }
    await initSkinBridge(role);

    renderRoot(<SkinModeApp />);
    if (auxContext) {
      emitSkinAuxReady(auxContext.skinId, auxContext.viewId);
    }
    return;
  }

  await bootstrapTheme();
  await bootstrapVisualizer();
  await bootstrapEqualizer();
  await bootstrapPlaybackSettings();
  await bootstrapSkin();

  await initPlayerStoreBridge(role);
  await initThemeBridge(role);
  await initVisualizerBridge(role);
  await initEqBridge(role);
  await initSkinBridge(role);

  if (isSkinModeWindow()) {
    const { activePack, activeViewId } = useSkinStore.getState();
    if (activePack) {
      await preloadSkinSwitchAssets(activePack, activeViewId);
    }
  }

  const Root = isAnySkinWindow()
    ? SkinModeApp
    : isAppearanceWindow()
      ? AppearanceApp
      : App;

  renderRoot(<Root />);
}

void start();
