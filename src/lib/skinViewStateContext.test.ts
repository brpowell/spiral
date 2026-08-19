import { describe, expect, it } from "vitest";
import { viewStateDataAttributes } from "./skinViewStateContext";

describe("viewStateDataAttributes", () => {
  it("maps view-state values to data-view-* attributes", () => {
    expect(
      viewStateDataAttributes({
        playlist: "open",
        shutter: 1,
        intro: false,
      }),
    ).toEqual({
      "data-view-playlist": "open",
      "data-view-shutter": "1",
      "data-view-intro": "false",
    });
  });
});
