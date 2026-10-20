import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ItemSummary } from "../../types/item";
import type {
  CatalogItemEntry,
  RegistryItemSummary,
} from "../../types/itemRegistry";

const { mockFetchCatalog, mockEnrich, mockInstall } = vi.hoisted(() => ({
  mockFetchCatalog: vi.fn(),
  mockEnrich: vi.fn(),
  mockInstall: vi.fn(),
}));

vi.mock("../../lib/itemRegistry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/itemRegistry")>()),
  fetchItemCatalogSafe: mockFetchCatalog,
  enrichItemCatalog: mockEnrich,
  installCatalogEntry: mockInstall,
  fetchRegistryItemSafe: vi.fn(async () => ({
    ok: true,
    detail: { versions: [] },
  })),
}));

vi.mock("../../lib/tauri", () => ({
  getAppVersion: vi.fn(async () => "1.0.0"),
}));

vi.mock("./ItemActionsMenu", () => ({
  ItemActionsMenu: ({ omitRemove }: { omitRemove?: boolean }) => (
    <div>item-actions:{omitRemove ? "no-uninstall" : "all"}</div>
  ),
}));

import { InstalledItemActions } from "./InstalledItemActions";

const item = {
  type: "skin",
  id: "headspace",
  publisherId: "spiral",
  effectiveId: "spiral.skin.headspace",
  name: "Headspace",
  zone: "installed",
} as ItemSummary;

function summary(): RegistryItemSummary {
  return {
    registryUrl: "https://registry.example",
    publisherId: "spiral",
    itemType: "skin",
    id: "headspace",
    effectiveId: "spiral.skin.headspace",
    latestVersion: {
      version: "1.0.1",
      sizeBytes: 1,
      sha256: "a".repeat(64),
      publishedAt: "2026-10-01T00:00:00Z",
    },
  };
}

function enriched(overrides?: Partial<CatalogItemEntry>): CatalogItemEntry {
  return {
    ...summary(),
    installedVersion: "1.0.1",
    installed: true,
    updateAvailable: false,
    meetsMinAppVersion: true,
    resolvedPreviewUrl: null,
    ...overrides,
  };
}

function setup() {
  const onAfterUninstall = vi.fn();
  render(
    <InstalledItemActions item={item} onAfterUninstall={onAfterUninstall} />,
  );
  return { onAfterUninstall };
}

describe("InstalledItemActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("offers Uninstall as the primary action when a registry lists the item", async () => {
    mockFetchCatalog.mockResolvedValue({
      ok: true,
      catalog: { items: [summary()], total: 1, errors: [] },
    });
    mockEnrich.mockResolvedValue([enriched()]);
    setup();

    // The "…" menu (Reveal in Finder) no longer repeats Uninstall.
    expect(await screen.findByText("item-actions:no-uninstall")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Uninstall" }));
    expect(await screen.findByText("Uninstall?")).toBeTruthy();
  });

  it("offers Update when a newer version is available", async () => {
    mockFetchCatalog.mockResolvedValue({
      ok: true,
      catalog: { items: [summary()], total: 1, errors: [] },
    });
    mockEnrich.mockResolvedValue([
      enriched({ installedVersion: "1.0.0", updateAvailable: true }),
    ]);
    setup();

    fireEvent.click(await screen.findByRole("button", { name: "Update" }));
    await waitFor(() => expect(mockInstall).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("button", { name: "Uninstall" })).toBeNull();
    // With Update primary, Uninstall lives in the "…" menu.
    expect(screen.getByText("item-actions:all")).toBeTruthy();
  });

  it("falls back to a plain Uninstall when no registry lists the item", async () => {
    mockFetchCatalog.mockResolvedValue({
      ok: false,
      error: "offline",
    });
    setup();

    expect(
      await screen.findByRole("button", { name: "Uninstall" }),
    ).toBeTruthy();
    expect(screen.getByText("item-actions:no-uninstall")).toBeTruthy();
  });
});
