import type { SkinViewActivateEffect } from "../types/skin";
import { runSkinAction } from "./skinActions";
import { playActiveSkinSound } from "./skinSoundEffects";
import {
  evaluateViewBind,
  type ViewStateValues,
} from "./skinViewStateContext";

function isEffectWhenTruthy(
  when: string | undefined,
  values: ViewStateValues,
): boolean {
  if (!when) return true;
  return evaluateViewBind(when, values) === true;
}

export function dispatchViewActivateEffect(
  effect: SkinViewActivateEffect,
  getValues: () => ViewStateValues,
): void {
  if (!isEffectWhenTruthy(effect.when, getValues())) return;
  if (effect.sound) playActiveSkinSound(effect.sound);
  runSkinAction(effect.action, effect.payload);
}

export function scheduleViewActivateEffects(
  effects: SkinViewActivateEffect[],
  getValues: () => ViewStateValues,
): () => void {
  const timers: ReturnType<typeof setTimeout>[] = [];

  for (const effect of effects) {
    if (!isEffectWhenTruthy(effect.when, getValues())) continue;

    const timer = setTimeout(
      () => dispatchViewActivateEffect(effect, getValues),
      effect.delayMs ?? 0,
    );
    timers.push(timer);
  }

  return () => {
    for (const timer of timers) {
      clearTimeout(timer);
    }
  };
}
