import React from "react";
import ReactDOM from "react-dom/client";
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
import { preloadSkinViewAssets } from "./lib/skinViewAssetPreload";
import { resolveAuxStartupRequirements } from "./lib/skinAuxStartupRequirements";
import { usePlaylistStore } from "./store/usePlaylistStore";
import { useSkinStore } from "./store/useSkinStore";
import { bootstrapTheme } from "./lib/themeBootstrap";
import { bootstrapVisualizer } from "./lib/visualizerBootstrap";
import { bootstrapEqualizer } from "./lib/equalizerBootstrap";
import {
  bootstrapWindowRole,
  getSkinAuxContext,
  isActivityLogsWindow,
  isAppearanceWindow,
  isEqualizerWindow,
  isAnySkinWindow,
  isSkinAuxWindow,
} from "./lib/windowRole";
import "./styles/theme.css";
import "./styles/scrollbars.css";

const root = document.getElementById("root") as HTMLElement;

async function start() {
  const role = await bootstrapWindowRole();

  if (isActivityLogsWindow()) {
    ReactDOM.createRoot(root).render(
      <React.StrictMode>
        <ActivityLogsApp />
      </React.StrictMode>,
    );
    return;
  }

  if (isEqualizerWindow()) {
    await bootstrapEqualizer();
    await initEqBridge(role);

    ReactDOM.createRoot(root).render(
      <React.StrictMode>
        <EqualizerApp />
      </React.StrictMode>,
    );
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

    ReactDOM.createRoot(root).render(
      <React.StrictMode>
        <SkinModeApp />
      </React.StrictMode>,
    );
    if (auxContext) {
      emitSkinAuxReady(auxContext.skinId, auxContext.viewId);
    }
    return;
  }

  await bootstrapTheme();
  await bootstrapVisualizer();
  await bootstrapEqualizer();

  if (isAnySkinWindow() || isAppearanceWindow()) {
    await bootstrapSkin();
  }
  await initPlayerStoreBridge(role);
  await initThemeBridge(role);
  await initVisualizerBridge(role);
  await initEqBridge(role);
  await initSkinBridge(role);

  const Root = isAnySkinWindow()
    ? SkinModeApp
    : isAppearanceWindow()
      ? AppearanceApp
      : App;

  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <Root />
    </React.StrictMode>,
  );
}

void start();
