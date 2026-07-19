import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  PACK_ARCHIVE_EXTENSION,
  PACK_MANIFEST_FILENAME,
  PACK_MANIFEST_VERSION,
} from "../../types/pack";
import {
  assertPackManifestVersion,
  effectiveContributionId,
  PackManifestError,
  parsePackManifest,
  parsePackManifestJson,
  slugifyId,
} from "./packManifest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

const samplePackPath = join(
  repoRoot,
  "src-tauri/packs/examples/midnight-drive.pack.json",
);

const schemaPath = join(
  repoRoot,
  "src-tauri/schemas/pack-v1.schema.json",
);

describe("pack archive convention", () => {
  it("uses .spk archives and pack.json manifests", () => {
    expect(PACK_ARCHIVE_EXTENSION).toBe(".spk");
    expect(PACK_MANIFEST_FILENAME).toBe("pack.json");
  });
});

describe("id helpers", () => {
  it("builds effective id as authorId.packId.type.contributionId", () => {
    expect(
      effectiveContributionId("bryan", "midnight-drive", "theme", "theme"),
    ).toBe("bryan.midnight-drive.theme.theme");
  });

  it("slugifies free text", () => {
    expect(slugifyId("T3: Skynet Media Player")).toBe("t3-skynet-media-player");
    expect(slugifyId("  ")).toBe("untitled");
  });
});

describe("parsePackManifest", () => {
  it("validates the sample pack.json", () => {
    const json = readFileSync(samplePackPath, "utf8");
    const pack = parsePackManifestJson(json);

    expect(pack.manifestVersion).toBe(PACK_MANIFEST_VERSION);
    expect(pack.packId).toBe("midnight-drive");
    expect(pack.authorId).toBe("bryan");
    expect(pack.version).toBe("1.0.0");
    expect("contributions" in pack).toBe(false);
  });

  it("fails fast on unsupported manifestVersion", () => {
    expect(() =>
      assertPackManifestVersion({ manifestVersion: 99, packId: "x" }),
    ).toThrow(PackManifestError);

    try {
      parsePackManifest({
        manifestVersion: 99,
        packId: "midnight-drive",
        authorId: "bryan",
        version: "1.0.0",
        name: "X",
        description: "",
      });
      expect.unreachable("expected unsupported manifestVersion to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(PackManifestError);
      expect((e as PackManifestError).code).toBe("unsupported_manifest_version");
      expect((e as PackManifestError).message).toMatch(/manifestVersion: 99/);
    }
  });

  it("fails fast when manifestVersion is missing", () => {
    try {
      parsePackManifest({
        packId: "midnight-drive",
        authorId: "bryan",
        version: "1.0.0",
        name: "X",
        description: "",
      });
      expect.unreachable("expected missing manifestVersion to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(PackManifestError);
      expect((e as PackManifestError).code).toBe("missing_manifest_version");
    }
  });

  it("rejects leftover contributions arrays", () => {
    expect(() =>
      parsePackManifest({
        manifestVersion: 1,
        packId: "midnight-drive",
        authorId: "bryan",
        version: "1.0.0",
        name: "Midnight Drive",
        description: "",
        contributions: [],
      }),
    ).toThrow(/must not declare contributions/);
  });

  it("rejects leftover pack-level author without authorId", () => {
    expect(() =>
      parsePackManifest({
        manifestVersion: 1,
        packId: "midnight-drive",
        author: "Bryan",
        version: "1.0.0",
        name: "Midnight Drive",
        description: "",
      }),
    ).toThrow(/authorId/);
  });
});

describe("pack-v1.schema.json", () => {
  it("locks manifestVersion to 1 and requires authorId", () => {
    const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as {
      required: string[];
      properties: {
        manifestVersion: { const: number };
        authorId: Record<string, unknown>;
        contributions?: unknown;
        author?: unknown;
      };
    };
    expect(schema.properties.manifestVersion.const).toBe(1);
    expect(schema.required).toContain("authorId");
    expect(schema.properties.authorId).toBeDefined();
    expect(schema.properties.contributions).toBeUndefined();
    expect(schema.properties.author).toBeUndefined();
  });
});
