import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cancelShutterIntro,
  playShutterClose,
  playShutterOpen,
  scheduleShutterIntro,
  SHUTTER_INTRO_DELAY_MS,
  toggleShutter,
} from "./skinShutter";
import type { SkinViewStateApi } from "./skinViewStateContext";
import * as viewState from "./skinViewStateContext";

function mockViewState(initial: Record<string, string | number | boolean>): {
  api: SkinViewStateApi;
  values: Record<string, string | number | boolean>;
} {
  const values = { ...initial };
  const api: SkinViewStateApi = {
    values,
    setVariable: (name, value) => {
      values[name] = value;
    },
    setScreen: (screen) => {
      values.screen = screen;
    },
    reset: () => {},
  };
  return { api, values };
}

describe("skinShutter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cancelShutterIntro();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("enters opening phase from intro", () => {
    const { api, values } = mockViewState({ shutter: "intro" });
    vi.spyOn(viewState, "getSkinViewStateApi").mockReturnValue(api);

    playShutterOpen();
    expect(values.shutter).toBe("opening");
  });

  it("toggles closed to open and open to closed", () => {
    const { api, values } = mockViewState({ shutter: "closed" });
    vi.spyOn(viewState, "getSkinViewStateApi").mockReturnValue(api);

    toggleShutter();
    expect(values.shutter).toBe("opening");
    values.shutter = "open";

    toggleShutter();
    expect(values.shutter).toBe("closing");
    values.shutter = "closed";
    expect(values.shutter).toBe("closed");
  });

  it("ignores toggle while animating", () => {
    const { api, values } = mockViewState({ shutter: "opening" });
    vi.spyOn(viewState, "getSkinViewStateApi").mockReturnValue(api);

    toggleShutter();
    expect(values.shutter).toBe("opening");
  });

  it("schedules intro open after delay", () => {
    const { api, values } = mockViewState({ shutter: "intro" });
    vi.spyOn(viewState, "getSkinViewStateApi").mockReturnValue(api);

    scheduleShutterIntro();
    expect(values.shutter).toBe("intro");

    vi.advanceTimersByTime(SHUTTER_INTRO_DELAY_MS);
    expect(values.shutter).toBe("opening");
  });

  it("playShutterClose only runs from open", () => {
    const { api, values } = mockViewState({ shutter: "intro" });
    vi.spyOn(viewState, "getSkinViewStateApi").mockReturnValue(api);

    playShutterClose();
    expect(values.shutter).toBe("intro");
  });
});
