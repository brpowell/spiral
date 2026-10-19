import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CatalogItemEntry,
  RegistryVersionSummary,
} from "../../types/itemRegistry";

const { mockFetchItem, mockFetchVersion, mockGetAppVersion } = vi.hoisted(
  () => ({
    mockFetchItem: vi.fn(),
    mockFetchVersion: vi.fn(),
    mockGetAppVersion: vi.fn(),
  }),
);

vi.mock("../../lib/itemRegistry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/itemRegistry")>()),
  fetchRegistryItemSafe: mockFetchItem,
  fetchRegistryItemVersionSafe: mockFetchVersion,
  peekRegistryItemVersion: () => undefined,
}));

vi.mock("../../lib/tauri", () => ({ getAppVersion: mockGetAppVersion }));

vi.mock("./ItemActionsMenu", () => ({
  ItemActionsMenu: ({ item }: { item: { effectiveId: string } }) => (
    <div>item-actions:{item.effectiveId}</div>
  ),
}));

import { RegistryItemDetailView } from "./RegistryItemDetailView";

function version(
  v: string,
  overrides?: Partial<RegistryVersionSummary>,
): RegistryVersionSummary {
  return {
    version: v,
    name: "Noir",
    description: "A dark theme.",
    sizeBytes: 2048,
    sha256: v.padEnd(64, "0"),
    publishedAt: "2026-10-01T00:00:00Z",
    ...overrides,
  };
}

function entry(overrides?: Partial<CatalogItemEntry>): CatalogItemEntry {
  return {
    registryUrl: "https://registry.example",
    publisherId: "spiral",
    itemType: "theme",
    id: "noir",
    effectiveId: "spiral.theme.noir",
    latestVersion: version("2.0.0"),
    installedVersion: null,
    installed: false,
    updateAvailable: false,
    meetsMinAppVersion: true,
    resolvedPreviewUrl: null,
    ...overrides,
  };
}

function setup(e: CatalogItemEntry, busy = false) {
  const onInstall = vi.fn().mockResolvedValue(undefined);
  render(
    <RegistryItemDetailView
      entry={e}
      busy={busy}
      backAriaLabel="Back to Get more"
      onBack={vi.fn()}
      onInstall={onInstall}
    />,
  );
  return { onInstall };
}

describe("RegistryItemDetailView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAppVersion.mockResolvedValue("0.4.0");
    mockFetchItem.mockResolvedValue({
      ok: true,
      detail: {
        versions: [version("2.0.0"), version("1.5.0"), version("1.0.0")],
      },
    });
    mockFetchVersion.mockResolvedValue({
      ok: true,
      detail: { readme: "# Noir\n\nDark and moody.", changelog: "- first" },
    });
  });

  it("shows details, facts and the README", async () => {
    setup(entry());
    expect(screen.getByRole("heading", { name: "Noir" })).toBeTruthy();
    expect(screen.getByText("A dark theme.")).toBeTruthy();
    expect(screen.getByText("spiral.theme.noir")).toBeTruthy();
    expect(screen.getByText("2.0 KB")).toBeTruthy();
    expect(await screen.findByText("Dark and moody.")).toBeTruthy();
  });

  it("offers Install for an item that is not installed", async () => {
    const { onInstall } = setup(entry());
    fireEvent.click(await screen.findByRole("button", { name: "Install" }));
    expect(onInstall).toHaveBeenCalledWith();
    expect(screen.queryByText("item-actions:spiral.theme.noir")).toBeNull();
  });

  it("offers Update plus the item actions when an older version is installed", async () => {
    const { onInstall } = setup(
      entry({ installedVersion: "1.0.0", updateAvailable: true }),
    );
    expect(
      await screen.findByText("item-actions:spiral.theme.noir"),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Update" }));
    expect(onInstall).toHaveBeenCalledWith();
    expect(screen.queryByRole("button", { name: "Install" })).toBeNull();
  });

  it("shows Installed and no install button when current", async () => {
    setup(entry({ installed: true, installedVersion: "2.0.0" }));
    expect(
      await screen.findByText("Installed", { selector: "span" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Install" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Update" })).toBeNull();
  });

  it("disables installing when the app is too old", async () => {
    setup(entry({ meetsMinAppVersion: false }));
    const button = await screen.findByRole("button", {
      name: "Requires app update",
    });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Install" })).toBeNull();
  });

  it("installs another version from the menu, confirming a downgrade first", async () => {
    const { onInstall } = setup(
      entry({ installedVersion: "2.0.0", installed: true }),
    );
    await waitFor(() => expect(mockFetchItem).toHaveBeenCalled());

    fireEvent.click(
      await screen.findByRole("button", { name: "Install another version" }),
    );
    fireEvent.click(
      await screen.findByRole("menuitemradio", { name: "v1.5.0" }),
    );

    // Older than what is installed: nothing happens until confirmed.
    expect(onInstall).not.toHaveBeenCalled();
    expect(
      await screen.findByText(/replaces v2\.0\.0 of Noir with v1\.5\.0/i),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    await waitFor(() => expect(onInstall).toHaveBeenCalledTimes(1));
    expect(onInstall.mock.calls[0]![0]).toMatchObject({ version: "1.5.0" });
  });

  it("explains a missing README", async () => {
    mockFetchVersion.mockResolvedValue({
      ok: true,
      detail: { readme: null, changelog: null },
    });
    setup(entry());
    expect(await screen.findByText("No About for this item.")).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Changelog" })).toBeNull();
  });

  it("shows the Changelog tab when the version has one", async () => {
    setup(entry());
    const tab = await screen.findByRole("tab", { name: "Changelog" });
    fireEvent.click(tab);
    expect(await screen.findByText("first")).toBeTruthy();
  });
});
