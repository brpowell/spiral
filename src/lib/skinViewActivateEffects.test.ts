import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  dispatchViewActivateEffect,
  scheduleViewActivateEffects,
} from "./skinViewActivateEffects";
import * as skinActions from "./skinActions";
import * as skinSoundEffects from "./skinSoundEffects";
import type { SkinViewActivateEffect } from "../types/skin";
import type { ViewStateValues } from "./skinViewStateContext";

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
    const values: ViewStateValues = { introLight: "pending" };

    dispatchViewActivateEffect(introLightEffect, () => values);

    expect(skinActions.runSkinAction).toHaveBeenCalledWith(
      "view.setVariable",
      introLightEffect.payload,
    );
  });

  it("skips action when when guard is false at fire time", () => {
    const values: ViewStateValues = { introLight: "playing" };

    dispatchViewActivateEffect(introLightEffect, () => values);

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

    const values: ViewStateValues = { shutter: "intro" };
    dispatchViewActivateEffect(shutterIntroEffect, () => values);

    expect(callOrder).toEqual(["sound", "action"]);
    expect(skinSoundEffects.playActiveSkinSound).toHaveBeenCalledWith("open");
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
    const values: ViewStateValues = { introLight: "pending" };

    scheduleViewActivateEffects([introLightEffect], () => values);
    vi.runAllTimers();

    expect(skinActions.runSkinAction).toHaveBeenCalledTimes(1);
  });

  it("runs delayed effects after delayMs", () => {
    const values: ViewStateValues = { shutter: "intro" };

    scheduleViewActivateEffects([shutterIntroEffect], () => values);
    expect(skinActions.runSkinAction).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    expect(skinActions.runSkinAction).toHaveBeenCalledWith(
      "view.setVariable",
      shutterIntroEffect.payload,
    );
  });

  it("no-ops delayed effect when when guard becomes false before fire", () => {
    const values: ViewStateValues = { shutter: "intro" };
    const getValues = () => values;

    scheduleViewActivateEffects([shutterIntroEffect], getValues);
    values.shutter = "opening";

    vi.advanceTimersByTime(1000);
    expect(skinActions.runSkinAction).not.toHaveBeenCalled();
  });

  it("cancel clears pending timers", () => {
    const values: ViewStateValues = { shutter: "intro" };

    const cancel = scheduleViewActivateEffects([shutterIntroEffect], () => values);
    cancel();

    vi.advanceTimersByTime(1000);
    expect(skinActions.runSkinAction).not.toHaveBeenCalled();
  });
});
