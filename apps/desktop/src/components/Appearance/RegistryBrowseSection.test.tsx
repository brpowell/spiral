import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetCatalogView } from "../../store/useCatalogViewStore";
import type {
  CatalogItemEntry,
  RegistryItemSummary,
} from "../../types/itemRegistry";

const { mockFetchCatalog, mockEnrich, mockInstall, mockPrefetch } = vi.hoisted(
  () => ({
    mockFetchCatalog: vi.fn(),
    mockEnrich: vi.fn(),
    mockInstall: vi.fn(),
    mockPrefetch: vi.fn(),
  }),
);

vi.mock("../../lib/itemRegistry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/itemRegistry")>()),
  fetchItemCatalogSafe: mockFetchCatalog,
  enrichItemCatalog: mockEnrich,
  installCatalogEntry: mockInstall,
  prefetchItemDetail: mockPrefetch,
}));

vi.mock("./RegistryItemDetailView", () => ({
  RegistryItemDetailView: ({
    entry,
    onBack,
    onInstall,
  }: {
    entry: CatalogItemEntry;
    onBack: () => void;
    onInstall: () => void;
  }) => (
    <div>
      <span>detail:{entry.effectiveId}</span>
      <button onClick={onBack}>back</button>
      <button onClick={onInstall}>install-from-detail</button>
    </div>
  ),
}));

import {
  RegistryBrowseSection,
  resetCatalogSnapshots,
} from "./RegistryBrowseSection";

function summary(id: string, itemType = "theme", version = "1.0.0") {
  return {
    registryUrl: "https://registry.example",
    publisherId: "spiral",
    itemType,
    id,
    effectiveId: `spiral.${itemType}.${id}`,
    latestVersion: {
      version,
      name: id.toUpperCase(),
      description: "",
      sizeBytes: 10,
      sha256: "a".repeat(64),
      publishedAt: "2026-10-01T00:00:00Z",
    },
  } as RegistryItemSummary;
}

function enriched(
  items: RegistryItemSummary[],
  overrides?: Partial<CatalogItemEntry>,
): CatalogItemEntry[] {
  return items.map((item) => ({
    ...item,
    installedVersion: null,
    installed: false,
    updateAvailable: false,
    meetsMinAppVersion: true,
    resolvedPreviewUrl: null,
    ...overrides,
  }));
}

function catalogOf(items: RegistryItemSummary[], total = items.length) {
  return { ok: true, catalog: { items, total, errors: [] } };
}

describe("RegistryBrowseSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCatalogSnapshots();
    resetCatalogView();
    mockEnrich.mockImplementation(async (items: RegistryItemSummary[]) =>
      enriched(items),
    );
    mockInstall.mockResolvedValue(null);
  });

  it("loads the first page and renders one card per item", async () => {
    mockFetchCatalog.mockResolvedValue(
      catalogOf([summary("noir"), summary("grove", "skin")]),
    );
    render(<RegistryBrowseSection />);

    expect(await screen.findByText("NOIR")).toBeTruthy();
    expect(screen.getByText("GROVE")).toBeTruthy();
    expect(mockFetchCatalog).toHaveBeenCalledWith(
      expect.objectContaining({
        itemTypes: [],
        q: "",
        sort: "name",
        limit: 48,
        offset: 0,
      }),
    );
  });

  it("filters by type through the server query", async () => {
    mockFetchCatalog.mockResolvedValue(catalogOf([summary("noir")]));
    render(<RegistryBrowseSection />);
    await screen.findByText("NOIR");

    fireEvent.click(screen.getByRole("button", { name: "Filter by type" }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Skins" }));
    await waitFor(() =>
      expect(mockFetchCatalog).toHaveBeenCalledWith(
        expect.objectContaining({ itemTypes: ["skin"], offset: 0 }),
      ),
    );

    // Filters combine; clearing them returns to everything.
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Themes" }));
    await waitFor(() =>
      expect(mockFetchCatalog).toHaveBeenCalledWith(
        expect.objectContaining({ itemTypes: ["skin", "theme"] }),
      ),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Clear filters" }));
    await waitFor(() =>
      expect(mockFetchCatalog).toHaveBeenLastCalledWith(
        expect.objectContaining({ itemTypes: [] }),
      ),
    );
  });

  it("sorts through the server query", async () => {
    mockFetchCatalog.mockResolvedValue(catalogOf([summary("noir")]));
    render(<RegistryBrowseSection />);
    await screen.findByText("NOIR");

    fireEvent.click(screen.getByRole("button", { name: "Sort by" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Newest" }));
    await waitFor(() =>
      expect(mockFetchCatalog).toHaveBeenCalledWith(
        expect.objectContaining({ sort: "newest", offset: 0 }),
      ),
    );
  });

  it("debounces search into the server query", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mockFetchCatalog.mockResolvedValue(catalogOf([summary("noir")]));
      render(<RegistryBrowseSection />);
      await screen.findByText("NOIR");
      mockFetchCatalog.mockClear();

      const box = screen.getByRole("textbox", { name: "Search the catalog" });
      fireEvent.change(box, { target: { value: "no" } });
      fireEvent.change(box, { target: { value: "noir" } });
      expect(mockFetchCatalog).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(350);
      });
      await waitFor(() => expect(mockFetchCatalog).toHaveBeenCalledTimes(1));
      expect(mockFetchCatalog).toHaveBeenCalledWith(
        expect.objectContaining({ q: "noir", offset: 0 }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("loads the next page and appends without duplicates", async () => {
    const first = Array.from({ length: 3 }, (_, i) => summary(`a${i}`));
    mockFetchCatalog.mockResolvedValueOnce(catalogOf(first, 5));
    render(<RegistryBrowseSection />);
    await screen.findByText("A0");

    mockFetchCatalog.mockResolvedValueOnce(
      catalogOf([summary("a2"), summary("b0"), summary("b1")], 5),
    );
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));

    expect(await screen.findByText("B1")).toBeTruthy();
    expect(mockFetchCatalog).toHaveBeenLastCalledWith(
      expect.objectContaining({ offset: 3 }),
    );
    expect(screen.getAllByText("A2")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("shows the unreachable state and retries", async () => {
    mockFetchCatalog.mockResolvedValueOnce({ ok: false, error: "offline" });
    render(<RegistryBrowseSection />);
    expect(await screen.findByText("Couldn't reach the catalog")).toBeTruthy();

    mockFetchCatalog.mockResolvedValue(catalogOf([summary("noir")]));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("NOIR")).toBeTruthy();
    expect(mockFetchCatalog).toHaveBeenLastCalledWith(
      expect.objectContaining({ force: true }),
    );
  });

  it("explains an empty filtered result", async () => {
    mockFetchCatalog.mockResolvedValue(catalogOf([]));
    render(<RegistryBrowseSection />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Filter by type" }),
    );
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Themes" }));
    expect(await screen.findByText("Nothing matches.")).toBeTruthy();
  });

  it("installs an update from the card", async () => {
    const item = summary("noir", "theme", "2.0.0");
    mockFetchCatalog.mockResolvedValue(catalogOf([item]));
    mockEnrich.mockImplementation(async (items: RegistryItemSummary[]) =>
      enriched(items, { installedVersion: "1.0.0", updateAvailable: true }),
    );
    render(<RegistryBrowseSection />);

    fireEvent.click(await screen.findByRole("button", { name: "Update NOIR" }));
    await waitFor(() => expect(mockInstall).toHaveBeenCalledTimes(1));
    expect(mockInstall).toHaveBeenCalledWith(
      expect.objectContaining({ id: "noir", effectiveId: "spiral.theme.noir" }),
      undefined,
    );
  });

  it("opens the detail view for a card and returns to the list", async () => {
    mockFetchCatalog.mockResolvedValue(catalogOf([summary("noir")]));
    render(<RegistryBrowseSection />);
    fireEvent.click(await screen.findByRole("button", { name: /NOIR/ }));

    expect(await screen.findByText("detail:spiral.theme.noir")).toBeTruthy();
    fireEvent.click(screen.getByText("back"));
    expect(await screen.findByText("NOIR")).toBeTruthy();
  });

  it("remembers the open item, filters, sort and search after leaving the catalog", async () => {
    mockFetchCatalog.mockResolvedValue(catalogOf([summary("noir")]));
    const first = render(<RegistryBrowseSection />);
    await screen.findByText("NOIR");

    fireEvent.click(screen.getByRole("button", { name: "Filter by type" }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Themes" }));
    fireEvent.click(screen.getByRole("button", { name: "Sort by" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Newest" }));
    fireEvent.change(screen.getByLabelText("Search the catalog"), {
      target: { value: "noir" },
    });
    fireEvent.click(await screen.findByRole("button", { name: /NOIR/ }));
    expect(await screen.findByText("detail:spiral.theme.noir")).toBeTruthy();

    // Another Studio section replaces the catalog, then the user comes back.
    first.unmount();
    mockFetchCatalog.mockClear();
    render(<RegistryBrowseSection />);

    expect(await screen.findByText("detail:spiral.theme.noir")).toBeTruthy();
    expect(mockFetchCatalog).toHaveBeenCalledWith(
      expect.objectContaining({
        itemTypes: ["theme"],
        sort: "newest",
        q: "noir",
      }),
    );
    fireEvent.click(screen.getByText("back"));
    const search = await screen.findByLabelText("Search the catalog");
    expect((search as HTMLInputElement).value).toBe("noir");
  });
});
