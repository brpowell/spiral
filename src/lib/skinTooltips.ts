import { useMemo } from "react";
import {
  EQ_BAND_FREQUENCIES_HZ,
  formatEqBandFrequency,
  formatEqGainDb,
  ratioToGainDb,
} from "./equalizer/types";
import { formatRemainingTime, formatTime } from "./format";
import { t, tUnchecked } from "./i18n";
import {
  evaluateSkinBind,
  type SkinBindState,
  useSkinBindState,
} from "./skinBinds";

export interface SkinTooltipConfig {
  action?: string;
  viewId?: string;
  id?: string;
  tooltip?: string;
  tooltipWhen?: Record<string, string>;
}

export interface SkinTooltipLiveContext {
  /** Slider mode for built-in defaults. */
  sliderMode?: "seek" | "volume" | "balance" | "eq" | "slider";
  /** Live pointer ratio 0–1 (sliders / seek). */
  ratio?: number;
  /** EQ band index (1-based) for eq sliders. */
  eqBand?: number;
  /** Digit time display mode. */
  showElapsed?: boolean;
  /** Live playhead, so the tooltip is not stuck on the last bind snapshot. */
  positionSeconds?: number;
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
    if (evaluateSkinBind(condition, state)) {
      resolved = label;
    }
  }
  return resolved;
}

function repeatModeLabel(mode: string): string {
  switch (mode) {
    case "one":
      return t("playback:transport.repeatOne");
    case "all":
      return t("playback:transport.repeatAll");
    default:
      return t("playback:transport.repeatOff");
  }
}

type ViewActionPrefix = "switchTo" | "open" | "close" | "toggle";

function viewActionLabel(
  prefix: ViewActionPrefix,
  viewId: string | undefined,
  state: SkinBindState,
): string {
  if (!viewId) return tUnchecked(`playback:skinTooltips.${prefix}`);
  const open = evaluateSkinBind(`skin.view.${viewId}.open`, state);
  if (typeof open === "boolean") {
    return open
      ? t("playback:skinTooltips.closeNamed", { view: viewId })
      : t("playback:skinTooltips.openNamed", { view: viewId });
  }
  return tUnchecked(`playback:skinTooltips.${prefix}Named`, { view: viewId });
}

function defaultActionTooltip(
  config: SkinTooltipConfig,
  state: SkinBindState,
): string | null {
  const { action, viewId, id } = config;
  if (!action) return id ?? null;

  switch (action) {
    case "player.toggleMute":
      return state.muted
        ? t("playback:volume.unmute")
        : t("playback:volume.mute");
    case "player.togglePlayPause":
      return state.playbackState === "playing"
        ? t("playback:transport.pause")
        : t("playback:transport.play");
    case "player.play":
      return t("playback:transport.play");
    case "player.pause":
      return t("playback:transport.pause");
    case "player.stop":
      return t("playback:skinTooltips.stop");
    case "player.previousTrack":
      return t("playback:skinTooltips.previous");
    case "player.nextTrack":
      return t("playback:skinTooltips.next");
    case "player.cycleRepeat":
      return t("playback:skinTooltips.repeat", {
        mode: repeatModeLabel(String(state.repeatMode)),
      });
    case "player.toggleRepeat":
      return state.repeatMode === "off"
        ? t("playback:skinTooltips.turnRepeatOn")
        : t("playback:skinTooltips.turnRepeatOff");
    case "player.toggleShuffle":
      return state.shuffle
        ? t("playback:transport.shuffleOff")
        : t("playback:transport.shuffleOn");
    case "navigation.openAlbum":
      return t("playback:skinTooltips.openAlbum");
    case "skin.openPicker":
      return t("playback:skinTooltips.chooseSkin");
    case "skin.toggleAlwaysOnTop":
      return state.alwaysOnTop
        ? t("playback:skinTooltips.unpinWindow")
        : t("playback:skinTooltips.pinWindow");
    case "skin.restoreMainWindow":
      return t("playback:skinTooltips.restoreMainWindow");
    case "skin.exit":
      return t("playback:skinTooltips.exitSkinMode");
    case "skin.minimize":
      return t("playback:skinTooltips.minimizeWindow");
    case "skin.switchView":
      return viewActionLabel("switchTo", viewId, state);
    case "skin.openView":
      return viewActionLabel("open", viewId, state);
    case "skin.closeView":
      return viewActionLabel("close", viewId, state);
    case "skin.toggleView":
      return viewActionLabel("toggle", viewId, state);
    case "skin.toggleSoundEffects":
      return state.soundEffectsEnabled
        ? t("playback:skinTooltips.disableSoundEffects")
        : t("playback:skinTooltips.enableSoundEffects");
    case "visualizer.previous":
      return t("playback:skinTooltips.previousVisualizer");
    case "visualizer.next":
      return t("playback:skinTooltips.nextVisualizer");
    case "eq.reset":
      return t("playback:skinTooltips.resetEq");
    case "eq.previousPreset":
      return t("playback:skinTooltips.previousEqPreset");
    case "eq.nextPreset":
      return t("playback:skinTooltips.nextEqPreset");
    case "app.quit":
      return t("playback:skinTooltips.quit");
    case "app.openUrl":
      return t("playback:skinTooltips.openLink");
    case "app.openFile":
      return t("playback:skinTooltips.importFiles");
    case "slideshow.prev":
      return t("playback:skinTooltips.previousPage");
    case "slideshow.next":
      return t("playback:skinTooltips.nextPage");
    case "scrollStrip.prev":
      return t("playback:skinTooltips.previous");
    case "scrollStrip.next":
      return t("playback:skinTooltips.next");
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
      return t("playback:skinTooltips.volume", {
        percent: Math.round(vol * 100),
      });
    }
    case "balance": {
      const bal = ratio !== undefined ? ratio * 2 - 1 : state.balance;
      if (Math.abs(bal) < 0.05) return t("playback:skinTooltips.balanceCenter");
      const pct = Math.round(Math.abs(bal) * 100);
      return bal < 0
        ? t("playback:skinTooltips.balanceLeft", { percent: pct })
        : t("playback:skinTooltips.balanceRight", { percent: pct });
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
      return t("playback:skinTooltips.eqBand", {
        freq,
        gain: formatEqGainDb(gain),
      });
    }
    default:
      return null;
  }
}

function defaultDigitTimeTooltip(
  showElapsed: boolean | undefined,
  state: SkinBindState,
  livePosition?: number,
): string {
  const duration =
    state.currentTrack?.durationSeconds ??
    (typeof evaluateSkinBind("track.durationSeconds", state) === "number"
      ? (evaluateSkinBind("track.durationSeconds", state) as number)
      : 0);
  const position = livePosition ?? state.positionSeconds;
  if (showElapsed) {
    return t("playback:skinTooltips.elapsed", {
      time: formatTime(position),
    });
  }
  return t("playback:skinTooltips.remaining", {
    time: formatRemainingTime(position, duration),
  });
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
    return defaultDigitTimeTooltip(
      live.showElapsed,
      state,
      live.positionSeconds,
    );
  }

  const actionLabel = defaultActionTooltip(config, state);
  return actionLabel ?? config.id ?? "";
}

export function useSkinTooltip(
  config: SkinTooltipConfig,
  live: SkinTooltipLiveContext = {},
): string {
  const bindState = useSkinBindState();
  const { action, viewId, id, tooltip, tooltipWhen } = config;
  const { sliderMode, ratio, eqBand, showElapsed, positionSeconds } = live;

  return useMemo(
    () =>
      resolveSkinTooltip(
        { action, viewId, id, tooltip, tooltipWhen },
        bindState,
        { sliderMode, ratio, eqBand, showElapsed, positionSeconds },
      ),
    [
      action,
      viewId,
      id,
      tooltip,
      tooltipWhen,
      bindState,
      sliderMode,
      ratio,
      eqBand,
      showElapsed,
      positionSeconds,
    ],
  );
}
