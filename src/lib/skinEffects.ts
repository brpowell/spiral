import type { SkinClickEffect, SkinLifecycleEffect } from "../types/skin";
import { runSkinAction } from "./skinActions";
import { evaluateSkinCondition, type SkinBindState } from "./skinBinds";
import { playActiveSkinSound } from "./skinSoundEffects";

type SkinEffect = SkinClickEffect | SkinLifecycleEffect;

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
  if (!isEffectWhenTruthy(effect.when, getBindState)) return;
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
    if (!isEffectWhenTruthy(effect.when, getBindState)) continue;

    const timer = setTimeout(
      () => dispatchSkinEffect(effect, getBindState),
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
