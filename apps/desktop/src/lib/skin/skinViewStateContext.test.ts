import { describe, expect, it } from "vitest";
import { viewStateDataAttributes } from "./skinViewStateContext";

describe("viewStateDataAttributes", () => {
  it("maps view-state values to data-state-* attributes", () => {
    expect(
      viewStateDataAttributes({
        playlist: "open",
        shutter: 1,
        intro: false,
      }),
    ).toEqual({
      "data-state-playlist": "open",
      "data-state-shutter": "1",
      "data-state-intro": "false",
    });
  });
});
