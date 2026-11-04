import { describe, expect, it } from "vitest";
import { PREFERENCES_SECTIONS } from "./preferencesSections";

describe("PREFERENCES_SECTIONS", () => {
  it("has no Sources section: music folders live under Library", () => {
    const ids = PREFERENCES_SECTIONS.map((section) => section.id);
    expect(ids[0]).toBe("library");
    expect(ids).not.toContain("sources");
  });
});
