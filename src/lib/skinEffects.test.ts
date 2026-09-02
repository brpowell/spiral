import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  dispatchSkinEffect,
  primaryClickAction,
  scheduleSkinEffects,
} from "./skinEffects";
import * as skinActions from "./skinActions";
import * as skinSoundEffects from "./skinSoundEffects";
import * as skinViewStateContext from "./skinViewStateContext";
import type { SkinLifecycleEffect } from "../types/skin";
import { minimalBindState } from "../test/skinBindFixtures";

const introLightEffect: SkinLifecycleEffect = {
  when: "state.introLight.pending",
  action: "state.setVariable",
  payload: { variable: "introLight", value: "playing" },
};

const shutterIntroEffect: SkinLifecycleEffect = {
  when: "state.shutter.intro",
  delayMs: 1000,
  action: "state.setVariable",
  payload: { variable: "shutter", value: "opening" },
  sound: "open",
};

describe("dispatchSkinEffect", () => {
  beforeEach(() => {
    vi.spyOn(skinActions, "runSkinAction").mockImplementation(() => true);
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
      "state.setVariable",
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
      return true;
    });

    dispatchSkinEffect(shutterIntroEffect, () =>
      minimalBindState({ viewState: { shutter: "intro" } }),
    );

    expect(callOrder).toEqual(["sound", "action"]);
    expect(skinSoundEffects.playActiveSkinSound).toHaveBeenCalledWith("open");
  });

  it("evaluates compound when guards", () => {
    const effect: SkinLifecycleEffect = {
      when: { all: ["state.shutter.open", "state.xIntro.done"] },
      action: "state.setVariable",
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
    vi.spyOn(skinActions, "runSkinAction").mockImplementation(() => true);
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

  it("plays delayed sound-only click effect", () => {
    scheduleSkinEffects([{ delayMs: 500, sound: "inShutter" }], () =>
      minimalBindState(),
    );
    expect(skinSoundEffects.playActiveSkinSound).not.toHaveBeenCalled();
    expect(skinActions.runSkinAction).not.toHaveBeenCalled();

    vi.advanceTimersByTime(500);
    expect(skinSoundEffects.playActiveSkinSound).toHaveBeenCalledWith(
      "inShutter",
    );
    expect(skinActions.runSkinAction).not.toHaveBeenCalled();
  });

  it("runs delayed effects after delayMs", () => {
    scheduleSkinEffects([shutterIntroEffect], () =>
      minimalBindState({ viewState: { shutter: "intro" } }),
    );
    expect(skinActions.runSkinAction).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    expect(skinActions.runSkinAction).toHaveBeenCalledWith(
      "state.setVariable",
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
          when: "state.drawer.playlist",
          action: "state.setVariable",
          payload: { variable: "playlistVisible", value: true },
        },
      ],
      () => minimalBindState({ viewState }),
    );

    viewState.drawer = "playlist";
    vi.advanceTimersByTime(119);
    expect(skinActions.runSkinAction).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(skinActions.runSkinAction).toHaveBeenCalledWith(
      "state.setVariable",
      {
        variable: "playlistVisible",
        value: true,
      },
    );
  });

  it("delayed when uses live view state", () => {
    const liveValues: { drawer: string } = { drawer: "closed" };
    vi.spyOn(skinViewStateContext, "getSkinViewStateApi").mockReturnValue({
      get values() {
        return liveValues;
      },
      setVariable: () => {},
      reset: () => {},
    });

    scheduleSkinEffects(
      [
        {
          delayMs: 120,
          when: "state.drawer.playlist",
          action: "state.setVariable",
          payload: { variable: "playlistVisible", value: true },
        },
      ],
      () => minimalBindState({ viewState: { drawer: "closed" } }),
    );

    liveValues.drawer = "playlist";
    vi.advanceTimersByTime(120);
    expect(skinActions.runSkinAction).toHaveBeenCalledTimes(1);
  });

  it("chains delayed effects off live view state", () => {
    const liveValues: { phase: string } = { phase: "start" };
    vi.spyOn(skinViewStateContext, "getSkinViewStateApi").mockReturnValue({
      get values() {
        return liveValues;
      },
      setVariable: () => {},
      reset: () => {},
    });
    vi.mocked(skinActions.runSkinAction).mockImplementation(
      (_action, payload) => {
        if (payload?.variable) {
          liveValues[payload.variable as "phase"] = String(payload.value);
        }
        return true;
      },
    );

    scheduleSkinEffects(
      [
        {
          when: "state.phase.start",
          delayMs: 100,
          action: "state.setVariable",
          payload: { variable: "phase", value: "mid" },
        },
        {
          when: "state.phase.mid",
          delayMs: 200,
          action: "state.setVariable",
          payload: { variable: "phase", value: "end" },
        },
      ],
      () => minimalBindState({ viewState: { phase: "start" } }),
    );

    vi.advanceTimersByTime(99);
    expect(liveValues.phase).toBe("start");
    vi.advanceTimersByTime(1);
    expect(liveValues.phase).toBe("mid");
    vi.advanceTimersByTime(99);
    expect(liveValues.phase).toBe("mid");
    vi.advanceTimersByTime(1);
    expect(liveValues.phase).toBe("end");
  });

  it("plays a delayed transition sound only once when retriggered", () => {
    let applied = true;
    vi.mocked(skinActions.runSkinAction).mockImplementation((action) => {
      if (action !== "state.applyEvent") return true;
      const result = applied;
      applied = false;
      return result;
    });
    const effects = [
      {
        action: "state.applyEvent",
        payload: { variable: "compartment", event: "toggle" },
      },
      { delayMs: 500, sound: "inShutter" },
    ];
    const getBindState = () =>
      minimalBindState({ viewState: { compartment: "closed" } });

    scheduleSkinEffects(effects, getBindState);
    scheduleSkinEffects(effects, getBindState);
    vi.advanceTimersByTime(500);

    expect(skinSoundEffects.playActiveSkinSound).toHaveBeenCalledTimes(1);
    expect(skinSoundEffects.playActiveSkinSound).toHaveBeenCalledWith(
      "inShutter",
    );
  });

  it("does not schedule delayed siblings when state.applyEvent is a no-op", () => {
    vi.mocked(skinActions.runSkinAction).mockReturnValue(false);

    scheduleSkinEffects(
      [
        {
          action: "state.applyEvent",
          payload: { variable: "compartment", event: "toggle" },
        },
        { delayMs: 500, sound: "inShutter" },
      ],
      () => minimalBindState({ viewState: { compartment: "opening" } }),
    );

    vi.advanceTimersByTime(500);
    expect(skinSoundEffects.playActiveSkinSound).not.toHaveBeenCalled();
  });
});

describe("primaryClickAction", () => {
  it("skips leading sound-only effects", () => {
    expect(
      primaryClickAction([
        { delayMs: 500, sound: "inShutter" },
        { action: "state.applyEvent" },
      ]),
    ).toBe("state.applyEvent");
  });
});
