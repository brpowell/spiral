import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dispatchSkinEffect, scheduleSkinEffects } from "./skinEffects";
import * as skinActions from "./skinActions";
import * as skinSoundEffects from "./skinSoundEffects";
import * as skinViewStateContext from "./skinViewStateContext";
import type { SkinLifecycleEffect } from "../types/skin";
import { minimalBindState } from "../test/skinBindFixtures";

const introLightEffect: SkinLifecycleEffect = {
  when: "view.introLight.pending",
  action: "view.setVariable",
  payload: { variable: "introLight", value: "playing" },
};

const shutterIntroEffect: SkinLifecycleEffect = {
  when: "view.shutter.intro",
  delayMs: 1000,
  action: "view.setVariable",
  payload: { variable: "shutter", value: "opening" },
  sound: "open",
};

describe("dispatchSkinEffect", () => {
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
    dispatchSkinEffect(introLightEffect, () =>
      minimalBindState({ viewState: { introLight: "pending" } }),
    );

    expect(skinActions.runSkinAction).toHaveBeenCalledWith(
      "view.setVariable",
      introLightEffect.payload,
    );
  });

  it("skips action when when guard is false at fire time", () => {
    dispatchSkinEffect(introLightEffect, () =>
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

    dispatchSkinEffect(shutterIntroEffect, () =>
      minimalBindState({ viewState: { shutter: "intro" } }),
    );

    expect(callOrder).toEqual(["sound", "action"]);
    expect(skinSoundEffects.playActiveSkinSound).toHaveBeenCalledWith("open");
  });

  it("evaluates compound when guards", () => {
    const effect: SkinLifecycleEffect = {
      when: { all: ["view.shutter.open", "view.xIntro.done"] },
      action: "view.setVariable",
      payload: { variable: "chrome", value: "ready" },
    };

    dispatchSkinEffect(effect, () =>
      minimalBindState({ viewState: { shutter: "open", xIntro: "done" } }),
    );
    expect(skinActions.runSkinAction).toHaveBeenCalledTimes(1);

    vi.mocked(skinActions.runSkinAction).mockClear();
    dispatchSkinEffect(effect, () =>
      minimalBindState({ viewState: { shutter: "open", xIntro: "playing" } }),
    );
    expect(skinActions.runSkinAction).not.toHaveBeenCalled();
  });
});

describe("scheduleSkinEffects", () => {
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
    scheduleSkinEffects([introLightEffect], () =>
      minimalBindState({ viewState: { introLight: "pending" } }),
    );
    vi.runAllTimers();

    expect(skinActions.runSkinAction).toHaveBeenCalledTimes(1);
  });

  it("runs delayed effects after delayMs", () => {
    scheduleSkinEffects([shutterIntroEffect], () =>
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

    scheduleSkinEffects([shutterIntroEffect], getBindState);
    viewState.shutter = "opening";

    vi.advanceTimersByTime(1000);
    expect(skinActions.runSkinAction).not.toHaveBeenCalled();
  });

  it("cancel clears pending timers", () => {
    const cancel = scheduleSkinEffects([shutterIntroEffect], () =>
      minimalBindState({ viewState: { shutter: "intro" } }),
    );
    cancel();

    vi.advanceTimersByTime(1000);
    expect(skinActions.runSkinAction).not.toHaveBeenCalled();
  });

  it("skips immediate effects whose when is false", () => {
    scheduleSkinEffects([introLightEffect], () =>
      minimalBindState({ viewState: { introLight: "playing" } }),
    );
    vi.runAllTimers();
    expect(skinActions.runSkinAction).not.toHaveBeenCalled();
  });

  it("fires delayed effects if when becomes true", () => {
    const viewState = { drawer: "closed" };
    scheduleSkinEffects(
      [
        {
          delayMs: 120,
          when: "view.drawer.playlist",
          action: "view.setVariable",
          payload: { variable: "playlistVisible", value: true },
        },
      ],
      () => minimalBindState({ viewState }),
    );

    viewState.drawer = "playlist";
    vi.advanceTimersByTime(119);
    expect(skinActions.runSkinAction).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(skinActions.runSkinAction).toHaveBeenCalledWith("view.setVariable", {
      variable: "playlistVisible",
      value: true,
    });
  });

  it("delayed when uses live view state", () => {
    const liveValues: { drawer: string } = { drawer: "closed" };
    vi.spyOn(skinViewStateContext, "getSkinViewStateApi").mockReturnValue({
      get values() {
        return liveValues;
      },
      setVariable: () => {},
      setScreen: () => {},
      reset: () => {},
    });

    scheduleSkinEffects(
      [
        {
          delayMs: 120,
          when: "view.drawer.playlist",
          action: "view.setVariable",
          payload: { variable: "playlistVisible", value: true },
        },
      ],
      () => minimalBindState({ viewState: { drawer: "closed" } }),
    );

    liveValues.drawer = "playlist";
    vi.advanceTimersByTime(120);
    expect(skinActions.runSkinAction).toHaveBeenCalledTimes(1);
  });
});
