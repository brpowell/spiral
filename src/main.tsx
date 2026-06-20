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
import { bootstrapTheme } from "./lib/themeBootstrap";
import { bootstrapVisualizer } from "./lib/visualizerBootstrap";
import { bootstrapEqualizer } from "./lib/equalizerBootstrap";
import {
  bootstrapWindowRole,
  isActivityLogsWindow,
  isAppearanceWindow,
  isEqualizerWindow,
  isSkinModeWindow,
} from "./lib/windowRole";
import "./styles/theme.css";
import "./styles/scrollbars.css";

const root = document.getElementById("root") as HTMLElement;

async function start() {
  await bootstrapTheme();
  await bootstrapVisualizer();
  const role = await bootstrapWindowRole();
  await bootstrapEqualizer();

  if (isActivityLogsWindow()) {
    ReactDOM.createRoot(root).render(
      <React.StrictMode>
        <ActivityLogsApp />
      </React.StrictMode>,
    );
    return;
  }

  if (isEqualizerWindow()) {
    await initEqBridge(role);

    ReactDOM.createRoot(root).render(
      <React.StrictMode>
        <EqualizerApp />
      </React.StrictMode>,
    );
    return;
  }

  if (isSkinModeWindow() || isAppearanceWindow()) {
    await bootstrapSkin();
  }
  await initPlayerStoreBridge(role);
  await initThemeBridge(role);
  await initVisualizerBridge(role);
  await initEqBridge(role);
  await initSkinBridge(role);

  const Root = isSkinModeWindow()
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
