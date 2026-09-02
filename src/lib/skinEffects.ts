import type { SkinClickEffect } from "../types/skin";
import { runSkinAction } from "./skinActions";
import { evaluateSkinCondition, type SkinBindState } from "./skinBinds";
import { playActiveSkinSound } from "./skinSoundEffects";
import { getSkinViewStateApi } from "./skinViewStateContext";

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
  return effects?.find((effect) => effect.action);
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
  when: SkinClickEffect["when"],
  getBindState: () => SkinBindState,
): boolean {
  if (!when) return true;
  return evaluateSkinCondition(when, getBindState());
}

export function dispatchSkinEffect(
  effect: SkinClickEffect,
  getBindState: () => SkinBindState,
): boolean {
  if (!isEffectWhenTruthy(effect.when, () => liveBindState(getBindState))) {
    return false;
  }
  if (effect.sound) playActiveSkinSound(effect.sound);
  if (!effect.action) return true;
  return runSkinAction(effect.action, effect.payload);
}

function isApplyStateEvent(effect: SkinClickEffect): boolean {
  return effect.action === "view.applyStateEvent";
}

export function scheduleSkinEffects(
  effects: SkinClickEffect[] | undefined,
  getBindState: () => SkinBindState,
): () => void {
  const timers: ReturnType<typeof setTimeout>[] = [];
  if (!effects?.length) return () => {};

  let applyAttempted = false;
  let applySucceeded = false;

  for (const effect of effects) {
    if ((effect.delayMs ?? 0) !== 0) continue;
    if (isApplyStateEvent(effect)) applyAttempted = true;
    const applied = dispatchSkinEffect(effect, getBindState);
    if (isApplyStateEvent(effect) && applied) applySucceeded = true;
  }

  if (applyAttempted && !applySucceeded) {
    return () => {};
  }

  for (const effect of effects) {
    const delayMs = effect.delayMs ?? 0;
    if (delayMs === 0) continue;

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
