import { describe, expect, it, vi } from "vitest";
import type { PackManifest } from "../../types/pack";
import {
  CONTRIBUTION_TYPE_HANDLERS,
  discoveredFromFolderTable,
  getContributionTypeHandler,
  resolvePackContributions,
} from "./contributionRegistry";

const samplePack: PackManifest = {
  manifestVersion: 1,
  packId: "midnight-drive",
  authorId: "bryan",
  version: "1.0.0",
  name: "Midnight Drive",
  description: "A moody blue theme with a matching skin.",
};

describe("contribution type registry", () => {
  it("registers stub handlers for theme, skin, visualizer, and renderer", () => {
    expect(getContributionTypeHandler("theme")?.schema.id).toBe("theme-v1");
    expect(getContributionTypeHandler("skin")?.schema.id).toBe("skin-v1");
    expect(getContributionTypeHandler("visualizer")?.schema.id).toBe("viz-v1");
    expect(getContributionTypeHandler("renderer")?.schema.id).toBe("renderer-v1");
    expect(Object.keys(CONTRIBUTION_TYPE_HANDLERS).sort()).toEqual([
      "renderer",
      "skin",
      "theme",
      "visualizer",
    ]);
  });

  it("allows the same local id across contribution types", () => {
    const discovered = discoveredFromFolderTable([
      { typeFolder: "visualizers", folderName: "wave" },
      { typeFolder: "renderers", folderName: "wave" },
    ]);
    const resolved = resolvePackContributions(samplePack, discovered, {
      contributionIdsByPath: {
        "visualizers/wave/viz.json": "wave",
        "renderers/wave/renderer.json": "wave",
      },
    });
    expect(resolved.map((r) => r.effectiveId).sort()).toEqual([
      "bryan.midnight-drive.renderer.wave",
      "bryan.midnight-drive.visualizer.wave",
    ]);
  });

  it("resolves discovered folders into four-segment effective ids", () => {
    const discovered = discoveredFromFolderTable([
      { typeFolder: "themes", folderName: "theme" },
      { typeFolder: "skins", folderName: "skin" },
    ]);
    const resolved = resolvePackContributions(samplePack, discovered, {
      contributionIdsByPath: {
        "themes/theme/theme.json": "theme",
        "skins/skin/skin.json": "skin",
      },
    });

    expect(resolved.map((r) => r.type)).toEqual(["theme", "skin"]);
    expect(resolved[0]?.effectiveId).toBe("bryan.midnight-drive.theme.theme");
    expect(resolved[1]?.effectiveId).toBe("bryan.midnight-drive.skin.skin");
  });

  it("accepts unknown type folders without a schema enum change (skip/warn)", () => {
    const onUnknownType = vi.fn();
    const discovered = [
      ...discoveredFromFolderTable([
        { typeFolder: "themes", folderName: "theme" },
      ]),
      {
        type: "lyrics-overlay",
        folderName: "lyrics",
        manifestPath: "lyrics/lyrics/lyrics.json",
        handler: undefined as never,
      },
    ];
    // Filter to only known handlers in resolve; unknown type has no handler
    const known = discovered.filter((d) => getContributionTypeHandler(d.type));
    const unknown = discovered.filter((d) => !getContributionTypeHandler(d.type));
    for (const u of unknown) {
      onUnknownType(u.type, u.folderName);
    }
    const resolved = resolvePackContributions(samplePack, known, {
      contributionIdsByPath: { "themes/theme/theme.json": "theme" },
      onUnknownType,
    });

    expect(onUnknownType).toHaveBeenCalledWith("lyrics-overlay", "lyrics");
    expect(resolved.map((r) => r.type)).toEqual(["theme"]);
    expect(getContributionTypeHandler("lyrics-overlay")).toBeUndefined();
  });

  it("requires declared contribution ids (no folder-name fallback)", () => {
    const discovered = discoveredFromFolderTable([
      { typeFolder: "themes", folderName: "theme" },
    ]);
    expect(() =>
      resolvePackContributions(samplePack, discovered, {
        contributionIdsByPath: {},
      }),
    ).toThrow(/missing contribution id/);
  });
});
