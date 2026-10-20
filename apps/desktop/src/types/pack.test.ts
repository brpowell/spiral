import { describe, expect, it } from "vitest";
import { isAuthoringPackZone, isEditablePackZone } from "./pack";

describe("isEditablePackZone", () => {
  it("always allows authoring zones", () => {
    expect(isEditablePackZone("workshop")).toBe(true);
    expect(isEditablePackZone("linked")).toBe(true);
  });

  it("never allows installed items", () => {
    expect(isEditablePackZone("installed")).toBe(false);
  });

  it("allows built-ins in dev builds only", () => {
    expect(isEditablePackZone("builtin")).toBe(import.meta.env.DEV);
    expect(isAuthoringPackZone("builtin")).toBe(false);
  });
});
