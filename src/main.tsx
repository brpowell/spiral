import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { I18nextProvider } from "react-i18next";
import { WINDOW_READY_EVENT, warmResidentWindows } from "./lib/appWindows";
import App from "./App";
import { AboutApp } from "./AboutApp";
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
import {
  preloadSkinSwitchAssets,
  preloadSkinViewAssets,
} from "./lib/skinViewAssetPreload";
import { resolveAuxStartupRequirements } from "./lib/skinAuxStartupRequirements";
import { usePlaylistStore } from "./store/usePlaylistStore";
import { useSkinStore } from "./store/useSkinStore";
import { bootstrapTheme } from "./lib/themeBootstrap";
import { bootstrapVisualizer } from "./lib/visualizerBootstrap";
import { bootstrapEqualizer } from "./lib/equalizerBootstrap";
import { bootstrapPlaybackSettings } from "./lib/playbackSettingsBootstrap";
import { ToastLabApp } from "./ToastLabApp";
import { initCrashHandlers, installCrashDevConsole } from "./lib/crashReport";
import { installToastDevConsole } from "./lib/toastDevConsole";
import { installDevUserTimingGuard } from "./lib/devUserTimingGuard";
import {
  bootstrapWindowRole,
  getSkinAuxContext,
  isAboutWindow,
  isActivityLogsWindow,
  isAppearanceWindow,
  isEqualizerWindow,
  isAnySkinWindow,
  isSkinAuxWindow,
  isSkinModeWindow,
  isToastLabWindow,
  isSoundLabWindow,
} from "./lib/windowRole";
import { applyCustomWindowChrome } from "./lib/windowChrome";
import { i18n } from "./lib/i18n";
import "./styles/theme.css";
import "./styles/scrollbars.css";

const root = document.getElementById("root") as HTMLElement;

/**
 * Signals openers that this webview's effects (event listeners) have run.
 * Deferred so React Strict Mode's setup/cleanup/setup pass settles first.
 */
function WindowReadySignal() {
  useEffect(() => {
    let label: string;
    try {
      label = getCurrentWindow().label;
    } catch {
      return;
    }
    const timer = window.setTimeout(() => {
      void emit(WINDOW_READY_EVENT, { label });
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  return null;
}

function renderRoot(node: React.ReactNode) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <I18nextProvider i18n={i18n}>
        {node}
        <WindowReadySignal />
      </I18nextProvider>
    </React.StrictMode>,
  );
}

async function start() {
  initCrashHandlers();
  installCrashDevConsole();
  installToastDevConsole();
  installDevUserTimingGuard();
  if (import.meta.env.DEV) {
    const { installSoundDevConsole } = await import("./lib/soundDevConsole");
    installSoundDevConsole();
  }

  const role = await bootstrapWindowRole();

  // Library + secondary utility windows (not skins — already frameless).
  // Runs alongside the theme load; the native window is already configured.
  const chrome =
    role === "main" ||
    role === "appearance" ||
    role === "equalizer" ||
    role === "activity-logs" ||
    role === "about" ||
    role === "toast-lab" ||
    role === "sound-lab"
      ? applyCustomWindowChrome()
      : Promise.resolve();

  if (isToastLabWindow()) {
    await Promise.all([chrome, bootstrapTheme()]);
    await initThemeBridge(role);
    renderRoot(<ToastLabApp />);
    return;
  }

  if (import.meta.env.DEV && isSoundLabWindow()) {
    await Promise.all([chrome, bootstrapTheme()]);
    await initThemeBridge(role);
    const { SoundLabApp } = await import("./SoundLabApp");
    renderRoot(<SoundLabApp />);
    return;
  }

  if (isAboutWindow()) {
    await Promise.all([chrome, bootstrapTheme()]);
    await initThemeBridge(role);

    renderRoot(<AboutApp />);
    return;
  }

  if (isActivityLogsWindow()) {
    await Promise.all([chrome, bootstrapTheme()]);
    await initThemeBridge(role);

    renderRoot(<ActivityLogsApp />);
    return;
  }

  if (isEqualizerWindow()) {
    await Promise.all([chrome, bootstrapTheme(), bootstrapEqualizer()]);
    await Promise.all([initThemeBridge(role), initEqBridge(role)]);

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

    const pending: Promise<unknown>[] = [];
    if (needs?.theme) {
      pending.push(bootstrapTheme().then(() => initThemeBridge(role)));
    }
    if (needs?.visualizer) {
      pending.push(
        bootstrapVisualizer().then(() => initVisualizerBridge(role)),
      );
    }
    if (activePack && auxContext) {
      pending.push(preloadSkinViewAssets(activePack, auxContext.viewId));
    }
    await Promise.all(pending);
    await Promise.all([
      initPlayerStoreBridge(role),
      !needs || needs.eq ? initEqBridge(role) : Promise.resolve(),
      needs?.playlists
        ? usePlaylistStore.getState().loadPlaylists()
        : Promise.resolve(),
      initSkinBridge(role),
    ]);

    renderRoot(<SkinModeApp />);
    if (auxContext) {
      emitSkinAuxReady(auxContext.skinId, auxContext.viewId);
    }
    return;
  }

  // Theme, playback, and EQ are what the library window's first frame reads.
  // Skin and visualizer packs are full directory walks; on the library window
  // they finish after paint so they don't hold the window closed.
  const paint = Promise.all([
    chrome,
    bootstrapTheme(),
    bootstrapPlaybackSettings(),
    bootstrapEqualizer(),
  ]);
  const showsPackUi = isSkinModeWindow() || isAppearanceWindow();
  if (showsPackUi) {
    await Promise.all([paint, bootstrapVisualizer(), bootstrapSkin()]);
  } else {
    await paint;
  }

  await Promise.all([
    initPlayerStoreBridge(role),
    initThemeBridge(role),
    initVisualizerBridge(role),
    initEqBridge(role),
    initSkinBridge(role),
  ]);

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

  if (role === "main") {
    void Promise.all([bootstrapVisualizer(), bootstrapSkin()])
      .catch((err: unknown) => {
        console.error("Deferred startup bootstrap failed:", err);
      })
      .then(() => warmResidentWindows())
      .catch((err: unknown) => {
        console.error("Failed to warm resident windows:", err);
      });
  }
}

void start();
