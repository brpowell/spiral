import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  dispatchViewActivateEffect,
  scheduleViewActivateEffects,
} from "./skinViewActivateEffects";
import * as skinActions from "./skinActions";
import * as skinSoundEffects from "./skinSoundEffects";
import type { SkinViewActivateEffect } from "../types/skin";
import { minimalBindState } from "../test/skinBindFixtures";

const introLightEffect: SkinViewActivateEffect = {
  when: "view.introLight.pending",
  action: "view.setVariable",
  payload: { variable: "introLight", value: "playing" },
};

const shutterIntroEffect: SkinViewActivateEffect = {
  when: "view.shutter.intro",
  delayMs: 1000,
  action: "view.setVariable",
  payload: { variable: "shutter", value: "opening" },
  sound: "open",
};

describe("dispatchViewActivateEffect", () => {
  beforeEach(() => {
    vi.spyOn(skinActions, "runSkinAction").mockImplementation(() => {});
    vi.spyOn(skinSoundEffects, "playActiveSkinSound").mockImplementation(
      () => {},
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("runs action when when guard is truthy", () => {
    dispatchViewActivateEffect(introLightEffect, () =>
      minimalBindState({ viewState: { introLight: "pending" } }),
    );

    expect(skinActions.runSkinAction).toHaveBeenCalledWith(
      "view.setVariable",
      introLightEffect.payload,
    );
  });

  it("skips action when when guard is false at fire time", () => {
    dispatchViewActivateEffect(introLightEffect, () =>
      minimalBindState({ viewState: { introLight: "playing" } }),
    );

    expect(skinActions.runSkinAction).not.toHaveBeenCalled();
  });

  it("plays sound before action", () => {
    const callOrder: string[] = [];
    vi.mocked(skinSoundEffects.playActiveSkinSound).mockImplementation(() => {
      callOrder.push("sound");
    });
    vi.mocked(skinActions.runSkinAction).mockImplementation(() => {
      callOrder.push("action");
    });

    dispatchViewActivateEffect(shutterIntroEffect, () =>
      minimalBindState({ viewState: { shutter: "intro" } }),
    );

    expect(callOrder).toEqual(["sound", "action"]);
    expect(skinSoundEffects.playActiveSkinSound).toHaveBeenCalledWith("open");
  });

  it("evaluates compound when guards", () => {
    const effect: SkinViewActivateEffect = {
      when: { all: ["view.shutter.open", "view.xIntro.done"] },
      action: "view.setVariable",
      payload: { variable: "chrome", value: "ready" },
    };

    dispatchViewActivateEffect(effect, () =>
      minimalBindState({ viewState: { shutter: "open", xIntro: "done" } }),
    );
    expect(skinActions.runSkinAction).toHaveBeenCalledTimes(1);

    vi.mocked(skinActions.runSkinAction).mockClear();
    dispatchViewActivateEffect(effect, () =>
      minimalBindState({ viewState: { shutter: "open", xIntro: "playing" } }),
    );
    expect(skinActions.runSkinAction).not.toHaveBeenCalled();
  });
});

describe("scheduleViewActivateEffects", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(skinActions, "runSkinAction").mockImplementation(() => {});
    vi.spyOn(skinSoundEffects, "playActiveSkinSound").mockImplementation(
      () => {},
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("runs immediate effects without delay", () => {
    scheduleViewActivateEffects([introLightEffect], () =>
      minimalBindState({ viewState: { introLight: "pending" } }),
    );
    vi.runAllTimers();

    expect(skinActions.runSkinAction).toHaveBeenCalledTimes(1);
  });

  it("runs delayed effects after delayMs", () => {
    scheduleViewActivateEffects([shutterIntroEffect], () =>
      minimalBindState({ viewState: { shutter: "intro" } }),
    );
    expect(skinActions.runSkinAction).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    expect(skinActions.runSkinAction).toHaveBeenCalledWith(
      "view.setVariable",
      shutterIntroEffect.payload,
    );
  });

  it("no-ops delayed effect when when guard becomes false before fire", () => {
    const viewState = { shutter: "intro" };
    const getBindState = () => minimalBindState({ viewState });

    scheduleViewActivateEffects([shutterIntroEffect], getBindState);
    viewState.shutter = "opening";

    vi.advanceTimersByTime(1000);
    expect(skinActions.runSkinAction).not.toHaveBeenCalled();
  });

  it("cancel clears pending timers", () => {
    const cancel = scheduleViewActivateEffects([shutterIntroEffect], () =>
      minimalBindState({ viewState: { shutter: "intro" } }),
    );
    cancel();

    vi.advanceTimersByTime(1000);
    expect(skinActions.runSkinAction).not.toHaveBeenCalled();
  });
});
