import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ActivityLogsApp } from "./ActivityLogsApp";
import { SkinModeApp } from "./SkinModeApp";
import { SkinPickerApp } from "./SkinPickerApp";
import { initPlayerStoreBridge } from "./lib/playerStoreBridge";
import { initSkinBridge } from "./lib/skinBridge";
import { initThemeBridge } from "./lib/themeBridge";
import { bootstrapSkin } from "./lib/skinBootstrap";
import { bootstrapTheme } from "./lib/themeBootstrap";
import {
  bootstrapWindowRole,
  isActivityLogsWindow,
  isSkinModeWindow,
  isSkinPickerWindow,
} from "./lib/windowRole";
import "./styles/theme.css";

const root = document.getElementById("root") as HTMLElement;

async function start() {
  await bootstrapTheme();
  const role = await bootstrapWindowRole();

  if (isActivityLogsWindow()) {
    ReactDOM.createRoot(root).render(
      <React.StrictMode>
        <ActivityLogsApp />
      </React.StrictMode>,
    );
    return;
  }

  if (isSkinModeWindow() || isSkinPickerWindow()) {
    await bootstrapSkin();
  }
  await initPlayerStoreBridge(role);
  await initThemeBridge(role);
  await initSkinBridge(role);

  const Root = isSkinModeWindow()
    ? SkinModeApp
    : isSkinPickerWindow()
      ? SkinPickerApp
      : App;

  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <Root />
    </React.StrictMode>,
  );
}

void start();
