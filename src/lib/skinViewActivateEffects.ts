import type { SkinViewActivateEffect } from "../types/skin";
import { runSkinAction } from "./skinActions";
import { evaluateSkinCondition, type SkinBindState } from "./skinBinds";
import { playActiveSkinSound } from "./skinSoundEffects";

function isEffectWhenTruthy(
  when: SkinViewActivateEffect["when"],
  getBindState: () => SkinBindState,
): boolean {
  if (!when) return true;
  return evaluateSkinCondition(when, getBindState());
}

export function dispatchViewActivateEffect(
  effect: SkinViewActivateEffect,
  getBindState: () => SkinBindState,
): void {
  if (!isEffectWhenTruthy(effect.when, getBindState)) return;
  if (effect.sound) playActiveSkinSound(effect.sound);
  runSkinAction(effect.action, effect.payload);
}

export function scheduleViewActivateEffects(
  effects: SkinViewActivateEffect[],
  getBindState: () => SkinBindState,
): () => void {
  const timers: ReturnType<typeof setTimeout>[] = [];

  for (const effect of effects) {
    if (!isEffectWhenTruthy(effect.when, getBindState)) continue;

    const timer = setTimeout(
      () => dispatchViewActivateEffect(effect, getBindState),
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
