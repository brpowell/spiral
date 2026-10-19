import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockFetchItemCatalog,
  mockFetchRegistryItemVersion,
  mockListItems,
  mockItemMeetsMinAppVersion,
  mockResolveRegistryItemPreview,
} = vi.hoisted(() => ({
  mockFetchItemCatalog: vi.fn(),
  mockFetchRegistryItemVersion: vi.fn(),
  mockListItems: vi.fn(),
  mockItemMeetsMinAppVersion: vi.fn(),
  mockResolveRegistryItemPreview: vi.fn(),
}));

vi.mock("./tauri", () => ({
  fetchItemCatalog: mockFetchItemCatalog,
  fetchRegistryItemVersion: mockFetchRegistryItemVersion,
  listItems: mockListItems,
  itemMeetsMinAppVersion: mockItemMeetsMinAppVersion,
  resolveRegistryItemPreview: mockResolveRegistryItemPreview,
}));

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {},
  convertFileSrc: (path: string) => `asset://${path}`,
}));

import {
  catalogCacheKey,
  catalogItemKey,
  enrichItemCatalog,
  fetchItemCatalogSafe,
  fetchRegistryItemVersionSafe,
  invalidateRegistryCaches,
  isDownloadCancelled,
  sortVersionsNewestFirst,
  versionCmp,
  versionMeetsMinApp,
} from "./itemRegistry";
import {
  catalogItemName,
  type RegistryItemSummary,
  type RegistryVersionSummary,
} from "../types/itemRegistry";

const REGISTRY = "https://spk-registry.spiralpowered.com";

function versionSummary(
  version: string,
  overrides?: Partial<RegistryVersionSummary>,
): RegistryVersionSummary {
  return {
    version,
    sizeBytes: 1,
    sha256: "a".repeat(64),
    publishedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function catalogItem(
  id: string,
  version: string,
  overrides?: Partial<RegistryVersionSummary>,
  publisherId = "spiral",
): RegistryItemSummary {
  return {
    registryUrl: REGISTRY,
    publisherId,
    itemType: "theme",
    id,
    effectiveId: `${publisherId}.theme.${id}`,
    latestVersion: versionSummary(version, overrides),
  };
}

describe("item registry helpers", () => {
  it("keys catalog rows by registry URL and effective id", () => {
    const a = catalogItem("noir", "1.0.0");
    const b = { ...a, registryUrl: "https://mirror.example" };
    expect(catalogItemKey(a)).toBe(`${REGISTRY}:spiral.theme.noir`);
    expect(catalogItemKey(a)).not.toBe(catalogItemKey(b));
  });

  it("prefers the version name, then the item id", () => {
    expect(
      catalogItemName({ id: "noir", latestVersion: { name: "Noir" } }),
    ).toBe("Noir");
    expect(catalogItemName({ id: "noir", latest: { name: "Noir 2" } })).toBe(
      "Noir 2",
    );
    expect(catalogItemName({ id: "noir", latestVersion: { name: " " } })).toBe(
      "noir",
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

  it("recognises the Rust download-cancelled message", () => {
    expect(isDownloadCancelled("Item download cancelled")).toBe(true);
    expect(isDownloadCancelled("item download cancelled by user")).toBe(true);
    expect(isDownloadCancelled("registry returned 500")).toBe(false);
  });

  it("builds a stable catalog cache key from filters and paging", () => {
    expect(catalogCacheKey()).toBe(catalogCacheKey({}));
    expect(catalogCacheKey({ q: " noir " })).toBe(
      catalogCacheKey({ q: "noir" }),
    );
    expect(catalogCacheKey({ itemType: "theme" })).not.toBe(
      catalogCacheKey({ itemType: "skin" }),
    );
    expect(catalogCacheKey({ offset: 50 })).not.toBe(catalogCacheKey({}));
  });
});

describe("enrichItemCatalog", () => {
  beforeEach(() => {
    mockListItems.mockReset();
    mockItemMeetsMinAppVersion.mockReset().mockResolvedValue(true);
    mockResolveRegistryItemPreview.mockReset().mockResolvedValue(null);
  });

  function local(
    effectiveId: string,
    version: string,
    zone: "installed" | "builtin" | "workshop" | "linked" = "installed",
  ) {
    return { effectiveId, version, zone };
  }

  it("marks installed, update-available and not-installed from the installed zone", async () => {
    mockListItems.mockResolvedValue([
      local("spiral.theme.noir", "1.1.0"),
      local("spiral.theme.grove", "1.0.0"),
    ]);
    const entries = await enrichItemCatalog(
      [
        catalogItem("noir", "1.1.0"),
        catalogItem("grove", "2.0.0"),
        catalogItem("fresh", "1.0.0"),
      ],
      { resolvePreviews: false },
    );
    const byId = Object.fromEntries(entries.map((e) => [e.id, e]));
    expect(byId.noir).toMatchObject({
      installed: true,
      updateAvailable: false,
      installedVersion: "1.1.0",
    });
    expect(byId.grove).toMatchObject({
      installed: false,
      updateAvailable: true,
      installedVersion: "1.0.0",
    });
    expect(byId.fresh).toMatchObject({
      installed: false,
      updateAvailable: false,
      installedVersion: null,
    });
  });

  it("ignores builtin, workshop and linked copies", async () => {
    mockListItems.mockResolvedValue([
      local("spiral.theme.noir", "1.0.0", "builtin"),
      local("spiral.theme.grove", "1.0.0", "workshop"),
      local("spiral.theme.fresh", "1.0.0", "linked"),
    ]);
    const entries = await enrichItemCatalog(
      [
        catalogItem("noir", "1.0.0"),
        catalogItem("grove", "2.0.0"),
        catalogItem("fresh", "1.0.0"),
      ],
      { resolvePreviews: false },
    );
    for (const entry of entries) {
      expect(entry.installedVersion).toBeNull();
      expect(entry.installed).toBe(false);
      expect(entry.updateAvailable).toBe(false);
    }
  });

  it("does not offer a downgrade when a newer version is installed", async () => {
    mockListItems.mockResolvedValue([local("spiral.theme.noir", "3.0.0")]);
    const [entry] = await enrichItemCatalog([catalogItem("noir", "2.0.0")], {
      resolvePreviews: false,
    });
    expect(entry).toMatchObject({ installed: false, updateAvailable: false });
  });

  it("passes minAppVersion to the gate and reports the result", async () => {
    mockListItems.mockResolvedValue([]);
    mockItemMeetsMinAppVersion.mockResolvedValue(false);
    const [entry] = await enrichItemCatalog(
      [catalogItem("noir", "1.0.0", { minAppVersion: "9.0.0" })],
      { resolvePreviews: false },
    );
    expect(mockItemMeetsMinAppVersion).toHaveBeenCalledWith("9.0.0");
    expect(entry!.meetsMinAppVersion).toBe(false);
  });

  it("resolves previews through Rust unless told not to", async () => {
    mockListItems.mockResolvedValue([]);
    mockResolveRegistryItemPreview.mockResolvedValue("/cache/noir.png");
    const item = catalogItem("noir", "1.0.0", {
      previewUrl: "/v1/items/spiral/theme/noir/versions/1.0.0/preview",
    });

    const [withPreview] = await enrichItemCatalog([item]);
    expect(mockResolveRegistryItemPreview).toHaveBeenCalledWith({
      registryUrl: REGISTRY,
      previewUrl: "/v1/items/spiral/theme/noir/versions/1.0.0/preview",
    });
    expect(withPreview!.resolvedPreviewUrl).toBe("asset:///cache/noir.png");

    mockResolveRegistryItemPreview.mockClear();
    const [without] = await enrichItemCatalog([item], {
      resolvePreviews: false,
    });
    expect(mockResolveRegistryItemPreview).not.toHaveBeenCalled();
    expect(without!.resolvedPreviewUrl).toBeNull();
  });
});

describe("registry response caching", () => {
  beforeEach(() => {
    invalidateRegistryCaches();
    mockFetchItemCatalog.mockReset();
    mockFetchRegistryItemVersion.mockReset();
  });

  const catalog = { items: [{ id: "p" }], total: 1, errors: [] };

  it("serves the catalog from cache until forced", async () => {
    mockFetchItemCatalog.mockResolvedValue(catalog);
    await fetchItemCatalogSafe();
    await fetchItemCatalogSafe();
    expect(mockFetchItemCatalog).toHaveBeenCalledTimes(1);
    await fetchItemCatalogSafe({ force: true });
    expect(mockFetchItemCatalog).toHaveBeenCalledTimes(2);
  });

  it("keys the catalog cache by filters and paging", async () => {
    mockFetchItemCatalog.mockResolvedValue(catalog);
    await fetchItemCatalogSafe();
    await fetchItemCatalogSafe({ itemType: "skin" });
    await fetchItemCatalogSafe({ itemType: "skin", offset: 50 });
    expect(mockFetchItemCatalog).toHaveBeenCalledTimes(3);
  });

  it("passes filters (but not force) to the backend", async () => {
    mockFetchItemCatalog.mockResolvedValue(catalog);
    await fetchItemCatalogSafe({
      itemType: "theme",
      q: "noir",
      limit: 20,
      force: true,
    });
    expect(mockFetchItemCatalog).toHaveBeenCalledWith({
      itemType: "theme",
      q: "noir",
      limit: 20,
    });
  });

  it("does not cache failed or partial catalog fetches", async () => {
    mockFetchItemCatalog.mockRejectedValueOnce("offline");
    await expect(fetchItemCatalogSafe()).resolves.toEqual({
      ok: false,
      error: "offline",
    });

    mockFetchItemCatalog.mockResolvedValue({
      items: [{ id: "p" }],
      total: 1,
      errors: [{ registryUrl: "https://x", error: "down" }],
    });
    await fetchItemCatalogSafe();
    await fetchItemCatalogSafe();
    expect(mockFetchItemCatalog).toHaveBeenCalledTimes(3);
  });

  it("reports a failure when no registry returned items", async () => {
    mockFetchItemCatalog.mockResolvedValue({
      items: [],
      total: 0,
      errors: [{ registryUrl: "https://x", error: "down" }],
    });
    const result = await fetchItemCatalogSafe();
    expect(result).toEqual({ ok: false, error: "down" });
  });

  it("caches version detail per version and retries after a failure", async () => {
    const args = {
      registryUrl: "https://r",
      publisherId: "a",
      itemType: "theme",
      id: "p",
      version: "1.0.0",
    };
    mockFetchRegistryItemVersion.mockRejectedValueOnce("boom");
    expect((await fetchRegistryItemVersionSafe(args)).ok).toBe(false);

    mockFetchRegistryItemVersion.mockResolvedValue({ readme: "hi" });
    expect((await fetchRegistryItemVersionSafe(args)).ok).toBe(true);
    await fetchRegistryItemVersionSafe(args);
    expect(mockFetchRegistryItemVersion).toHaveBeenCalledTimes(2);

    await fetchRegistryItemVersionSafe({ ...args, version: "1.1.0" });
    expect(mockFetchRegistryItemVersion).toHaveBeenCalledTimes(3);
  });
});
