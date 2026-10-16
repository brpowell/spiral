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
  packIdentity,
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
  dirname(fileURLToPath(import.meta.url)),
  "fixtures/pack-v1.schema.json",
);

describe("pack archive convention", () => {
  it("uses .spk archives and pack.json manifests", () => {
    expect(PACK_ARCHIVE_EXTENSION).toBe(".spk");
    expect(PACK_MANIFEST_FILENAME).toBe("pack.json");
  });
});

describe("id helpers", () => {
  it("builds pack identity as publisherId.packId", () => {
    expect(packIdentity("bryan", "midnight-drive")).toBe("bryan.midnight-drive");
  });

  it("builds effective id as publisherId.packId.type.contributionId", () => {
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
    expect(pack.publisherId).toBe("bryan");
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
        publisherId: "bryan",
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
        publisherId: "bryan",
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
        publisherId: "bryan",
        version: "1.0.0",
        name: "Midnight Drive",
        description: "",
        contributions: [],
      }),
    ).toThrow(/must not declare contributions/);
  });

  it("rejects leftover pack-level author without publisherId", () => {
    expect(() =>
      parsePackManifest({
        manifestVersion: 1,
        packId: "midnight-drive",
        author: "Bryan",
        version: "1.0.0",
        name: "Midnight Drive",
        description: "",
      }),
    ).toThrow(/publisherId/);
  });

  it("accepts optional preview", () => {
    const pack = parsePackManifest({
      manifestVersion: 1,
      packId: "midnight-drive",
      publisherId: "bryan",
      version: "1.0.0",
      name: "Midnight Drive",
      description: "",
      preview: "preview.png",
    });
    expect(pack.preview).toBe("preview.png");
  });

  it("rejects empty preview", () => {
    expect(() =>
      parsePackManifest({
        manifestVersion: 1,
        packId: "midnight-drive",
        publisherId: "bryan",
        version: "1.0.0",
        name: "Midnight Drive",
        description: "",
        preview: "  ",
      }),
    ).toThrow(/preview/);
  });

  it("rejects svg preview", () => {
    expect(() =>
      parsePackManifest({
        manifestVersion: 1,
        packId: "midnight-drive",
        publisherId: "bryan",
        version: "1.0.0",
        name: "Midnight Drive",
        description: "",
        preview: "preview.svg",
      }),
    ).toThrow(/unsupported extension/);
  });
});

describe("pack-v1.schema.json", () => {
  it("locks manifestVersion to 1 and requires publisherId", () => {
    const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as {
      required: string[];
      properties: {
        manifestVersion: { const: number };
        publisherId: Record<string, unknown>;
        preview?: unknown;
        icon?: unknown;
        contributions?: unknown;
        author?: unknown;
      };
    };
    expect(schema.properties.manifestVersion.const).toBe(1);
    expect(schema.required).toContain("publisherId");
    expect(schema.properties.publisherId).toBeDefined();
    expect(schema.properties.preview).toBeDefined();
    expect(schema.properties.icon).toBeUndefined();
    expect(schema.properties.contributions).toBeUndefined();
    expect(schema.properties.author).toBeUndefined();
  });
});
