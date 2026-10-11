import { describe, expect, it } from "vitest";
import { resolveSkinClickSound } from "./skinSoundEffects";
import { minimalBindState } from "../test/skinBindFixtures";

describe("resolveSkinClickSound", () => {
  it("returns sound when soundWhen is omitted", () => {
    expect(resolveSkinClickSound("button", undefined, minimalBindState())).toBe(
      "button",
    );
  });

  it("uses the last matching soundWhen bind", () => {
    const state = minimalBindState({
      viewState: { shutter: "open" },
    });
    expect(
      resolveSkinClickSound(
        "button",
        {
          "state.shutter.intro": "open",
          "state.shutter.closed": "open",
          "state.shutter.open": "close",
        },
        state,
      ),
    ).toBe("close");
  });

  it("falls back to sound when no soundWhen bind matches", () => {
    const state = minimalBindState({
      viewState: { shutter: "opening" },
    });
    expect(
      resolveSkinClickSound(
        "button",
        {
          "state.shutter.open": "close",
        },
        state,
      ),
    ).toBe("button");
  });

  it("is silent when soundWhen has no match and sound is omitted", () => {
    const state = minimalBindState({
      viewState: { shutter: "opening" },
    });
    expect(
      resolveSkinClickSound(
        undefined,
        {
          "state.shutter.intro": "open",
          "state.shutter.closed": "open",
          "state.shutter.open": "close",
        },
        state,
      ),
    ).toBeUndefined();
  });
});
