import type { SkinClickEffect, SkinLifecycleEffect } from "../types/skin";
import { runSkinAction } from "./skinActions";
import { evaluateSkinCondition, type SkinBindState } from "./skinBinds";
import { playActiveSkinSound } from "./skinSoundEffects";
import { getSkinViewStateApi } from "./skinViewStateContext";

type SkinEffect = SkinClickEffect | SkinLifecycleEffect;

/** Prefer live view state over a click-time snapshot. */
function liveBindState(getBindState: () => SkinBindState): SkinBindState {
  const snapshot = getBindState();
  const liveView = getSkinViewStateApi()?.values;
  if (!liveView) return snapshot;
  return { ...snapshot, viewState: liveView };
}

function primarySkinEffect<T extends SkinClickEffect>(
  effects: T[] | undefined,
): T | undefined {
  return effects?.[0];
}

export function primaryClickAction(
  effects: SkinClickEffect[] | undefined,
): string | undefined {
  return primarySkinEffect(effects)?.action;
}

export function primaryClickViewId(
  effects: SkinClickEffect[] | undefined,
): string | undefined {
  return primarySkinEffect(effects)?.payload?.viewId;
}

function isEffectWhenTruthy(
  when: SkinEffect["when"],
  getBindState: () => SkinBindState,
): boolean {
  if (!when) return true;
  return evaluateSkinCondition(when, getBindState());
}

export function dispatchSkinEffect(
  effect: SkinEffect,
  getBindState: () => SkinBindState,
): void {
  if (!isEffectWhenTruthy(effect.when, () => liveBindState(getBindState))) {
    return;
  }
  if ("sound" in effect && effect.sound) playActiveSkinSound(effect.sound);
  runSkinAction(effect.action, effect.payload);
}

export function scheduleSkinEffects(
  effects: SkinEffect[] | undefined,
  getBindState: () => SkinBindState,
): () => void {
  const timers: ReturnType<typeof setTimeout>[] = [];
  if (!effects?.length) return () => {};

  for (const effect of effects) {
    const delayMs = effect.delayMs ?? 0;
    if (
      delayMs === 0 &&
      !isEffectWhenTruthy(effect.when, () => liveBindState(getBindState))
    ) {
      continue;
    }

    const timer = setTimeout(
      () => dispatchSkinEffect(effect, getBindState),
      delayMs,
    );
    timers.push(timer);
  }

  return () => {
    for (const timer of timers) {
      clearTimeout(timer);
    }
  };
}
