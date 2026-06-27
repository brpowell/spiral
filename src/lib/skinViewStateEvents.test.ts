import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyViewStateEvent } from "./skinViewStateEvents";
import * as skinSoundEffects from "./skinSoundEffects";
import type { SkinViewStateSpec } from "../types/skin";
import type { SkinViewStateApi } from "./skinViewStateContext";

const shutterToggle = [
  { from: ["intro", "closed"], set: "opening", sound: "open" },
  { from: ["open"], set: "closing", sound: "close" },
];

const shutterStateSpec: Record<string, SkinViewStateSpec> = {
  shutter: {
    default: "intro",
    on: { toggle: shutterToggle },
  },
};

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

describe("applyViewStateEvent", () => {
  beforeEach(() => {
    vi.spyOn(skinSoundEffects, "playActiveSkinSound").mockImplementation(
      () => {},
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("transitions intro and closed to opening with open sound", () => {
    const { api, values } = mockViewState({ shutter: "intro" });

    expect(
      applyViewStateEvent("shutter", "toggle", shutterStateSpec, api),
    ).toBe(true);
    expect(values.shutter).toBe("opening");
    expect(skinSoundEffects.playActiveSkinSound).toHaveBeenCalledWith("open");

    values.shutter = "closed";
    applyViewStateEvent("shutter", "toggle", shutterStateSpec, api);
    expect(values.shutter).toBe("opening");
  });

  it("transitions open to closing with close sound", () => {
    const { api, values } = mockViewState({ shutter: "open" });

    expect(
      applyViewStateEvent("shutter", "toggle", shutterStateSpec, api),
    ).toBe(true);
    expect(values.shutter).toBe("closing");
    expect(skinSoundEffects.playActiveSkinSound).toHaveBeenCalledWith("close");
  });

  it("no-ops while animating", () => {
    const { api, values } = mockViewState({ shutter: "opening" });

    expect(
      applyViewStateEvent("shutter", "toggle", shutterStateSpec, api),
    ).toBe(false);
    expect(values.shutter).toBe("opening");
    expect(skinSoundEffects.playActiveSkinSound).not.toHaveBeenCalled();

    values.shutter = "closing";
    expect(
      applyViewStateEvent("shutter", "toggle", shutterStateSpec, api),
    ).toBe(false);
  });

  it("plays sound before setVariable", () => {
    const callOrder: string[] = [];
    vi.mocked(skinSoundEffects.playActiveSkinSound).mockImplementation(() => {
      callOrder.push("sound");
    });
    const { api, values } = mockViewState({ shutter: "open" });
    const originalSetVariable = api.setVariable;
    api.setVariable = (name, value) => {
      callOrder.push("set");
      originalSetVariable(name, value);
    };

    applyViewStateEvent("shutter", "toggle", shutterStateSpec, api);

    expect(callOrder).toEqual(["sound", "set"]);
    expect(values.shutter).toBe("closing");
  });

  it("returns false when event or variable is unknown", () => {
    const { api } = mockViewState({ shutter: "open" });

    expect(
      applyViewStateEvent("shutter", "missing", shutterStateSpec, api),
    ).toBe(false);
    expect(
      applyViewStateEvent("unknown", "toggle", shutterStateSpec, api),
    ).toBe(false);
  });

  it("matches wildcard branch when from is omitted", () => {
    const spec: Record<string, SkinViewStateSpec> = {
      mode: { default: "a", on: { next: [{ set: "done" }] } },
    };
    const { api, values } = mockViewState({ mode: "anything" });

    expect(applyViewStateEvent("mode", "next", spec, api)).toBe(true);
    expect(values.mode).toBe("done");
  });
});
