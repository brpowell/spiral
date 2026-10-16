import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFetchPackCatalog, mockFetchRegistryPackVersion } = vi.hoisted(
  () => ({
    mockFetchPackCatalog: vi.fn(),
    mockFetchRegistryPackVersion: vi.fn(),
  }),
);

vi.mock("./tauri", () => ({
  fetchPackCatalog: mockFetchPackCatalog,
  fetchRegistryPackVersion: mockFetchRegistryPackVersion,
}));

import {
  fetchPackCatalogSafe,
  fetchRegistryPackVersionSafe,
  invalidateRegistryCaches,
  catalogPackKey,
  catalogDisplayName,
  installedPackKey,
  sortVersionsNewestFirst,
  versionCmp,
  versionMeetsMinApp,
} from "./packRegistry";
import type {
  RegistryPackSummary,
  RegistryVersionSummary,
} from "../types/packRegistry";

function versionSummary(
  version: string,
  overrides?: Partial<RegistryVersionSummary>,
): RegistryVersionSummary {
  return {
    version,
    contributionTypes: ["skin"],
    sizeBytes: 1,
    sha256: "a".repeat(64),
    publishedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("packRegistry helpers", () => {
  it("detects already-installed by publisherId.packId@version without a server round-trip", () => {
    const installed = new Set([
      "spiral.t3@1.0.0",
      "spiral.headspace@2.1.0",
      "alice.midnight-drive@1.0.0",
    ]);
    const catalog: RegistryPackSummary[] = [
      {
        registryUrl: "https://spk-registry.spiralpowered.com",
        publisherId: "spiral",
        packId: "t3",
        latestVersion: {
          version: "1.0.0",
          name: "T3",
          description: "Classic skin",
          contributionTypes: ["skin"],
          contributions: [],
          sizeBytes: 10,
          sha256: "a".repeat(64),
          publishedAt: "2026-01-01T00:00:00Z",
        },
      },
      {
        registryUrl: "https://spk-registry.spiralpowered.com",
        publisherId: "spiral",
        packId: "xbox",
        latestVersion: {
          version: "1.0.0",
          contributionTypes: ["skin"],
          sizeBytes: 10,
          sha256: "b".repeat(64),
          publishedAt: "2026-01-01T00:00:00Z",
        },
      },
      {
        registryUrl: "https://spk-registry.spiralpowered.com",
        publisherId: "bob",
        packId: "midnight-drive",
        latestVersion: {
          version: "1.0.0",
          contributionTypes: ["theme"],
          sizeBytes: 10,
          sha256: "c".repeat(64),
          publishedAt: "2026-01-01T00:00:00Z",
        },
      },
    ];

    expect(
      catalog.map((p) => ({
        packId: p.packId,
        publisherId: p.publisherId,
        installed: installed.has(
          installedPackKey(p.publisherId, p.packId, p.latestVersion.version),
        ),
      })),
    ).toEqual([
      { packId: "t3", publisherId: "spiral", installed: true },
      { packId: "xbox", publisherId: "spiral", installed: false },
      { packId: "midnight-drive", publisherId: "bob", installed: false },
    ]);
  });

  it("prefers catalog name over localName and packId", () => {
    expect(
      catalogDisplayName({
        packId: "t3",
        localName: "Local T3",
        latestVersion: { name: "Catalog T3" },
      }),
    ).toBe("Catalog T3");
    expect(
      catalogDisplayName({
        packId: "t3",
        localName: "Local T3",
        latestVersion: { name: "" },
      }),
    ).toBe("Local T3");
    expect(
      catalogDisplayName({
        packId: "t3",
        latestVersion: {},
      }),
    ).toBe("t3");
  });

  it("keys catalog rows by registry URL + author + pack", () => {
    const a: RegistryPackSummary = {
      registryUrl: "https://spk-registry.spiralpowered.com",
      publisherId: "spiral",
      packId: "t3",
      latestVersion: {
        version: "1.0.0",
        contributionTypes: ["skin"],
        sizeBytes: 1,
        sha256: "a".repeat(64),
        publishedAt: "2026-01-01T00:00:00Z",
      },
    };
    const b: RegistryPackSummary = {
      ...a,
      registryUrl: "https://mirror.example",
    };
    expect(catalogPackKey(a.registryUrl, a.publisherId, a.packId)).toBe(
      "https://spk-registry.spiralpowered.com:spiral/t3",
    );
    expect(catalogPackKey(b.registryUrl, b.publisherId, b.packId)).toBe(
      "https://mirror.example:spiral/t3",
    );
    expect(catalogPackKey(a.registryUrl, a.publisherId, a.packId)).not.toBe(
      catalogPackKey(b.registryUrl, b.publisherId, b.packId),
    );
  });

  it("compares semver cores like Rust version_cmp", () => {
    expect(versionCmp("1.0.0", "1.0.0")).toBe(0);
    expect(versionCmp("1.2.0", "1.0.9")).toBe(1);
    expect(versionCmp("1.0.0", "2.0.0")).toBe(-1);
    expect(versionCmp("1.0.0-beta", "1.0.0")).toBe(0);
    expect(versionCmp("not-semver", "1.0.0")).toBeNull();
  });

  it("sorts published versions newest-first", () => {
    const sorted = sortVersionsNewestFirst([
      versionSummary("1.0.0"),
      versionSummary("1.2.0"),
      versionSummary("1.1.0"),
    ]);
    expect(sorted.map((v) => v.version)).toEqual(["1.2.0", "1.1.0", "1.0.0"]);
  });

  it("checks minAppVersion against the running app", () => {
    expect(versionMeetsMinApp(null, "0.2.0")).toBe(true);
    expect(versionMeetsMinApp(undefined, "0.2.0")).toBe(true);
    expect(versionMeetsMinApp("0.2.0", "0.2.0")).toBe(true);
    expect(versionMeetsMinApp("0.1.0", "0.2.0")).toBe(true);
    expect(versionMeetsMinApp("0.3.0", "0.2.0")).toBe(false);
    expect(versionMeetsMinApp("not-semver", "0.2.0")).toBe(false);
  });

  it("flags update when catalog latest is newer than installed", () => {
    const installedVersion = "1.0.0";
    const latest = "1.1.0";
    const exactInstalled = installedPackKey("spiral", "wmp-t3", latest);
    const keys = new Set([
      installedPackKey("spiral", "wmp-t3", installedVersion),
    ]);
    const installed = keys.has(exactInstalled);
    const updateAvailable =
      !installed && versionCmp(latest, installedVersion) === 1;
    expect(installed).toBe(false);
    expect(updateAvailable).toBe(true);
  });

  it("does not flag update when same version is installed", () => {
    const version = "1.0.0";
    const keys = new Set([installedPackKey("spiral", "wmp-t3", version)]);
    const installed = keys.has(installedPackKey("spiral", "wmp-t3", version));
    const updateAvailable = !installed && versionCmp(version, version) === 1;
    expect(installed).toBe(true);
    expect(updateAvailable).toBe(false);
  });
});

describe("registry response caching", () => {
  beforeEach(() => {
    invalidateRegistryCaches();
    mockFetchPackCatalog.mockReset();
    mockFetchRegistryPackVersion.mockReset();
  });

  const catalog = { packs: [{ packId: "p" }], errors: [] };

  it("serves the catalog from cache until forced", async () => {
    mockFetchPackCatalog.mockResolvedValue(catalog);
    await fetchPackCatalogSafe();
    await fetchPackCatalogSafe();
    expect(mockFetchPackCatalog).toHaveBeenCalledTimes(1);
    await fetchPackCatalogSafe({ force: true });
    expect(mockFetchPackCatalog).toHaveBeenCalledTimes(2);
  });

  it("keys the catalog cache by filter options", async () => {
    mockFetchPackCatalog.mockResolvedValue(catalog);
    await fetchPackCatalogSafe();
    await fetchPackCatalogSafe({ publisherId: "alice" });
    expect(mockFetchPackCatalog).toHaveBeenCalledTimes(2);
  });

  it("does not cache failed or partial catalog fetches", async () => {
    mockFetchPackCatalog.mockRejectedValueOnce("offline");
    await expect(fetchPackCatalogSafe()).resolves.toEqual({
      ok: false,
      error: "offline",
    });

    mockFetchPackCatalog.mockResolvedValue({
      packs: [{ packId: "p" }],
      errors: [{ registryUrl: "https://x", error: "down" }],
    });
    await fetchPackCatalogSafe();
    await fetchPackCatalogSafe();
    expect(mockFetchPackCatalog).toHaveBeenCalledTimes(3);
  });

  it("caches version detail per version and retries after a failure", async () => {
    const args = {
      registryUrl: "https://r",
      publisherId: "a",
      packId: "p",
      version: "1.0.0",
    };
    mockFetchRegistryPackVersion.mockRejectedValueOnce("boom");
    expect((await fetchRegistryPackVersionSafe(args)).ok).toBe(false);

    mockFetchRegistryPackVersion.mockResolvedValue({ readme: "hi" });
    expect((await fetchRegistryPackVersionSafe(args)).ok).toBe(true);
    await fetchRegistryPackVersionSafe(args);
    expect(mockFetchRegistryPackVersion).toHaveBeenCalledTimes(2);

    await fetchRegistryPackVersionSafe({ ...args, version: "1.1.0" });
    expect(mockFetchRegistryPackVersion).toHaveBeenCalledTimes(3);
  });
});
