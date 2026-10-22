import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CatalogItemEntry } from "../../types/itemRegistry";
import { RegistryItemCard } from "./RegistryItemCard";

function entry(overrides?: Partial<CatalogItemEntry>): CatalogItemEntry {
  return {
    registryUrl: "https://registry.example",
    publisherId: "spiral",
    itemType: "theme",
    id: "noir",
    effectiveId: "spiral.theme.noir",
    latestVersion: {
      version: "2.0.0",
      name: "Noir",
      description: "A dark theme.",
      sizeBytes: 1200,
      sha256: "a".repeat(64),
      publishedAt: "2026-10-01T00:00:00Z",
    },
    installedVersion: null,
    installed: false,
    updateAvailable: false,
    meetsMinAppVersion: true,
    resolvedPreviewUrl: null,
    ...overrides,
  };
}

function setup(e: CatalogItemEntry, onUpdate?: () => void) {
  const onOpen = vi.fn();
  render(
    <RegistryItemCard
      entry={e}
      busy={false}
      onOpen={onOpen}
      onUpdate={onUpdate}
    />,
  );
  return { onOpen };
}

describe("RegistryItemCard", () => {
  it("shows the name, publisher and type icon, and opens on click", () => {
    const { onOpen } = setup(entry());
    expect(screen.getByText("Noir")).toBeTruthy();
    expect(screen.getByText("spiral")).toBeTruthy();
    expect(screen.getByTitle("Theme")).toBeTruthy();
    expect(screen.getByText("A dark theme.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Noir/ }));
    expect(onOpen).toHaveBeenCalled();
  });

  it("shows the manifest author, falling back to the publisher id", () => {
    const { unmount } = render(
      <RegistryItemCard
        entry={entry({
          latestVersion: {
            ...entry().latestVersion,
            author: "The Skins Factory",
          },
        })}
        busy={false}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByText("The Skins Factory")).toBeTruthy();
    expect(screen.queryByText("spiral")).toBeNull();
    unmount();
    setup(entry());
    expect(screen.getByText("spiral")).toBeTruthy();
  });

  it("falls back to the item id when the version has no name", () => {
    setup(
      entry({
        latestVersion: { ...entry().latestVersion, name: "" },
      }),
    );
    expect(screen.getByText("noir")).toBeTruthy();
  });

  it("marks an installed, current item", () => {
    setup(entry({ installed: true, installedVersion: "2.0.0" }));
    expect(screen.getByText("Installed")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Update Noir" })).toBeNull();
  });

  it("offers Update without opening the item", () => {
    const onUpdate = vi.fn();
    const { onOpen } = setup(
      entry({ installedVersion: "1.0.0", updateAvailable: true }),
      onUpdate,
    );
    fireEvent.click(screen.getByRole("button", { name: "Update Noir" }));
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("hides Update and flags the card when the app is too old", () => {
    setup(
      entry({
        installedVersion: "1.0.0",
        updateAvailable: true,
        meetsMinAppVersion: false,
      }),
      vi.fn(),
    );
    expect(screen.getByText("Requires app update")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Update Noir" })).toBeNull();
  });
});
