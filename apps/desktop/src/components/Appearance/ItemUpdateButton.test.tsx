import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useItemUpdatesStore } from "../../store/useItemUpdatesStore";
import type { ItemUpdate } from "../../types/itemRegistry";

const { mockInstall } = vi.hoisted(() => ({
  mockInstall: vi.fn(async () => null),
}));

vi.mock("../../lib/itemRegistry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/itemRegistry")>()),
  installRegistryItem: mockInstall,
}));

import { ItemUpdateButton } from "./ItemUpdateButton";

const update: ItemUpdate = {
  registryUrl: "https://registry.example",
  publisherId: "spiral",
  itemType: "skin",
  id: "headspace",
  effectiveId: "spiral.skin.headspace",
  installedVersion: "1.0.0",
  latest: {
    version: "1.0.1",
    sizeBytes: 5,
    sha256: "a".repeat(64),
    publishedAt: "2026-10-01T00:00:00Z",
  },
};

describe("ItemUpdateButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useItemUpdatesStore.setState({ pendingUpdates: [] });
  });

  it("renders nothing without a pending update", () => {
    const { container } = render(
      <ItemUpdateButton
        effectiveId="spiral.skin.headspace"
        zone="installed"
        name="Headspace"
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing for an item that is not installed", () => {
    useItemUpdatesStore.setState({ pendingUpdates: [update] });
    const { container } = render(
      <ItemUpdateButton
        effectiveId="spiral.skin.headspace"
        zone="workshop"
        name="Headspace"
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("installs the newer version when clicked", async () => {
    useItemUpdatesStore.setState({ pendingUpdates: [update] });
    render(
      <ItemUpdateButton
        effectiveId="spiral.skin.headspace"
        zone="installed"
        name="Headspace"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Update Headspace" }));
    await waitFor(() => expect(mockInstall).toHaveBeenCalledTimes(1));
    expect(mockInstall).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "headspace",
        version: "1.0.1",
        sha256: "a".repeat(64),
        name: "Headspace",
      }),
    );
  });
});
