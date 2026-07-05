import { useMemo } from "react";
import {
  EQ_BAND_FREQUENCIES_HZ,
  formatEqBandFrequency,
  ratioToGainDb,
} from "./equalizer/types";
import { formatRemainingTime, formatTime } from "./format";
import {
  evaluateSkinBind,
  type SkinBindState,
  useSkinBindState,
} from "./skinBinds";

export interface SkinTooltipConfig {
  action?: string;
  panelId?: string;
  viewId?: string;
  id?: string;
  tooltip?: string;
  tooltipWhen?: Record<string, string>;
}

export interface SkinTooltipLiveContext {
  /** Slider mode for built-in defaults. */
  sliderMode?: "seek" | "volume" | "balance" | "eq";
  /** Live pointer ratio 0–1 (sliders / seek). */
  ratio?: number;
  /** EQ band index (1-based) for eq sliders. */
  eqBand?: number;
  /** Digit time display mode. */
  showElapsed?: boolean;
}

function formatBindValue(value: string | number | boolean | null): string {
  if (value === null || typeof value === "boolean") return "";
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
  }
  return value;
}

function interpolateTooltipTemplate(
  template: string,
  state: SkinBindState,
): string {
  return template.replace(/\{([^}]+)\}/g, (_match, path: string) =>
    formatBindValue(evaluateSkinBind(path.trim(), state)),
  );
}

function resolveTooltipWhen(
  tooltipWhen: Record<string, string> | undefined,
  state: SkinBindState,
): string | null {
  if (!tooltipWhen) return null;
  let resolved: string | null = null;
  for (const [condition, label] of Object.entries(tooltipWhen)) {
    if (Boolean(evaluateSkinBind(condition, state))) {
      resolved = label;
    }
  }
  return resolved;
}

function repeatModeLabel(mode: string): string {
  switch (mode) {
    case "one":
      return "Repeat one";
    case "all":
      return "Repeat all";
    default:
      return "Repeat off";
  }
}

function viewActionLabel(
  prefix: string,
  viewId: string | undefined,
  state: SkinBindState,
): string {
  if (!viewId) return prefix;
  const open = evaluateSkinBind(`skin.panel.${viewId}.open`, state);
  if (typeof open === "boolean") {
    return open ? `Close ${viewId}` : `Open ${viewId}`;
  }
  return `${prefix} ${viewId}`;
}

function defaultActionTooltip(
  config: SkinTooltipConfig,
  state: SkinBindState,
): string | null {
  const { action, viewId, panelId, id } = config;
  if (!action) return id ?? null;

  switch (action) {
    case "player.toggleMute":
      return state.muted ? "Unmute" : "Mute";
    case "player.togglePlayPause":
      return state.playbackState === "playing" ? "Pause" : "Play";
    case "player.play":
      return "Play";
    case "player.pause":
      return "Pause";
    case "player.previousTrack":
      return "Previous";
    case "player.nextTrack":
      return "Next";
    case "player.cycleRepeat":
      return `Repeat: ${repeatModeLabel(String(state.repeatMode))}`;
    case "player.toggleRepeat":
      return state.repeatMode === "off" ? "Turn repeat on" : "Turn repeat off";
    case "player.toggleShuffle":
      return state.shuffle ? "Turn shuffle off" : "Turn shuffle on";
    case "player.clearSetList":
      return "Stop";
    case "queue.openSetList":
      return "View set list";
    case "navigation.openAlbum":
      return "Open album";
    case "skin.openPicker":
      return "Choose skin";
    case "skin.toggleAlwaysOnTop":
      return state.alwaysOnTop ? "Unpin window" : "Pin window on top";
    case "skin.restoreMainWindow":
      return "Restore main window";
    case "skin.exit":
      return "Exit skin mode";
    case "skin.minimize":
      return "Minimize window";
    case "skin.togglePanel":
      return panelId ? `Toggle ${panelId}` : "Toggle panel";
    case "skin.openPanel":
      return panelId ? `Open ${panelId}` : "Open panel";
    case "skin.closePanel":
      return panelId ? `Close ${panelId}` : "Close panel";
    case "skin.switchView":
      return viewActionLabel("Switch to", viewId, state);
    case "skin.openView":
      return viewActionLabel("Open", viewId, state);
    case "skin.closeView":
      return viewActionLabel("Close", viewId, state);
    case "skin.toggleView":
      return viewActionLabel("Toggle", viewId, state);
    case "skin.toggleSoundEffects":
      return state.soundEffectsEnabled
        ? "Disable sound effects"
        : "Enable sound effects";
    case "visualizer.previous":
      return "Previous visualizer";
    case "visualizer.next":
      return "Next visualizer";
    case "eq.reset":
      return "Reset EQ";
    case "eq.previousPreset":
      return "Previous EQ preset";
    case "eq.nextPreset":
      return "Next EQ preset";
    case "app.quit":
      return "Quit Spiral";
    case "app.openUrl":
      return "Open link";
    case "app.openFile":
      return "Import files";
    case "slideshow.prev":
      return "Previous page";
    case "slideshow.next":
      return "Next page";
    case "scrollStrip.prev":
      return "Previous";
    case "scrollStrip.next":
      return "Next";
    default:
      return id ?? action;
  }
}

function defaultSliderTooltip(
  live: SkinTooltipLiveContext,
  state: SkinBindState,
): string | null {
  const { sliderMode, ratio, eqBand } = live;
  if (!sliderMode) return null;

  switch (sliderMode) {
    case "volume": {
      const vol = ratio ?? state.volume;
      return `Volume: ${Math.round(vol * 100)}%`;
    }
    case "balance": {
      const bal = ratio !== undefined ? ratio * 2 - 1 : state.balance;
      if (Math.abs(bal) < 0.05) return "Balance: Center";
      const pct = Math.round(Math.abs(bal) * 100);
      return bal < 0 ? `Balance: L${pct}` : `Balance: R${pct}`;
    }
    case "seek": {
      const duration =
        state.currentTrack?.durationSeconds ??
        (typeof evaluateSkinBind("track.durationSeconds", state) === "number"
          ? (evaluateSkinBind("track.durationSeconds", state) as number)
          : 0);
      const posRatio = ratio ?? state.positionSeconds / (duration || 1);
      const position = posRatio * duration;
      if (!duration) return formatTime(position);
      return `${formatTime(position)} / ${formatTime(duration)}`;
    }
    case "eq": {
      if (eqBand === undefined || eqBand < 1) return null;
      const gain =
        ratio !== undefined
          ? ratioToGainDb(ratio)
          : (evaluateSkinBind(`eq.band.${eqBand}`, state) as number);
      const freq = formatEqBandFrequency(EQ_BAND_FREQUENCIES_HZ[eqBand - 1]);
      const sign = gain >= 0 ? "+" : "";
      return `${freq}: ${sign}${gain.toFixed(1)} dB`;
    }
    default:
      return null;
  }
}

function defaultDigitTimeTooltip(
  showElapsed: boolean | undefined,
  state: SkinBindState,
): string {
  const duration =
    state.currentTrack?.durationSeconds ??
    (typeof evaluateSkinBind("track.durationSeconds", state) === "number"
      ? (evaluateSkinBind("track.durationSeconds", state) as number)
      : 0);
  if (showElapsed) {
    return `Elapsed: ${formatTime(state.positionSeconds)} (click for remaining)`;
  }
  return `Remaining: ${formatRemainingTime(state.positionSeconds, duration)} (click for elapsed)`;
}

export function resolveSkinTooltip(
  config: SkinTooltipConfig,
  state: SkinBindState,
  live: SkinTooltipLiveContext = {},
): string {
  const whenLabel = resolveTooltipWhen(config.tooltipWhen, state);
  if (whenLabel) {
    return interpolateTooltipTemplate(whenLabel, state);
  }

  if (config.tooltip) {
    return interpolateTooltipTemplate(config.tooltip, state);
  }

  if (live.sliderMode) {
    const sliderLabel = defaultSliderTooltip(live, state);
    if (sliderLabel) return sliderLabel;
  }

  if (live.showElapsed !== undefined) {
    return defaultDigitTimeTooltip(live.showElapsed, state);
  }

  const actionLabel = defaultActionTooltip(config, state);
  return actionLabel ?? config.id ?? "";
}

export function useSkinTooltip(
  config: SkinTooltipConfig,
  live: SkinTooltipLiveContext = {},
): string {
  const bindState = useSkinBindState();
  const { action, panelId, viewId, id, tooltip, tooltipWhen } = config;
  const { sliderMode, ratio, eqBand, showElapsed } = live;

  return useMemo(
    () =>
      resolveSkinTooltip(
        { action, panelId, viewId, id, tooltip, tooltipWhen },
        bindState,
        { sliderMode, ratio, eqBand, showElapsed },
      ),
    [
      action,
      panelId,
      viewId,
      id,
      tooltip,
      tooltipWhen,
      bindState,
      sliderMode,
      ratio,
      eqBand,
      showElapsed,
    ],
  );
}
