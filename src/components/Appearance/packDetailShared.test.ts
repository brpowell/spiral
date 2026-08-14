import { describe, expect, it } from "vitest";
import type { PackSummary } from "../../types/pack";
import { isPreviousInstalledPack } from "./packDetailShared";

function pack(
  partial: Partial<PackSummary> & Pick<PackSummary, "version">,
): PackSummary {
  return {
    packId: "demo",
    authorId: "alice",
    name: "Demo",
    description: "",
    zone: "installed",
    packDir: `/packs/${partial.version}`,
    contributions: [],
    active: true,
    ...partial,
  };
}

describe("isPreviousInstalledPack", () => {
  it("marks inactive installed packs only", () => {
    expect(
      isPreviousInstalledPack(pack({ version: "1.0.0", active: false })),
    ).toBe(true);
    expect(
      isPreviousInstalledPack(pack({ version: "2.0.0", active: true })),
    ).toBe(false);
    expect(
      isPreviousInstalledPack(
        pack({ version: "1.0.0", zone: "workshop", active: false }),
      ),
    ).toBe(false);
  });
});
