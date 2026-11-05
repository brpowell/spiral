import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyIconTagTable,
  getLibraryIcon,
  listLibraryIcons,
} from "../../lib/iconLibrary";
import { ICON_TAGS_ENDPOINT } from "./saveIconTags";
import { IconLabShell } from "./IconLabShell";

const snapshot = Object.fromEntries(
  listLibraryIcons().map((icon) => [icon.id, [...icon.tags]]),
);

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    statusText: "OK",
    json: () => Promise.resolve({ ok: true }),
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  applyIconTagTable(snapshot);
});

function tile(id: string): HTMLElement {
  const grid = screen.getByRole("listbox", { name: "Icon catalog" });
  return within(grid).getByText(id).closest("button")!;
}

describe("IconLabShell", () => {
  it("lists every icon and a count", () => {
    render(<IconLabShell />);
    const total = listLibraryIcons().length;
    expect(screen.getByText(`${total} of ${total} icons`)).toBeTruthy();
    expect(tile("play")).toBeTruthy();
  });

  it("filters by search text and by tag", () => {
    render(<IconLabShell />);
    fireEvent.change(screen.getByLabelText("Search icons"), {
      target: { value: "chevron" },
    });
    expect(tile("chevronLeft")).toBeTruthy();
    expect(
      within(screen.getByRole("listbox", { name: "Icon catalog" })).queryByText(
        "play",
      ),
    ).toBeNull();

    fireEvent.change(screen.getByLabelText("Search icons"), {
      target: { value: "" },
    });
    const filters = screen.getByRole("group", { name: "Filter by tag" });
    fireEvent.click(within(filters).getByRole("button", { name: /^window/ }));
    expect(tile("maximize")).toBeTruthy();
    expect(
      within(screen.getByRole("listbox", { name: "Icon catalog" })).queryByText(
        "play",
      ),
    ).toBeNull();
  });

  it("shows the selected icon's tags and edits them", async () => {
    applyIconTagTable({ ...snapshot, play: ["music"] });
    render(<IconLabShell />);

    fireEvent.click(tile("play"));
    const detail = screen.getByRole("complementary", { name: "Selected icon" });
    expect(within(detail).getByText("music")).toBeTruthy();

    const input = within(detail).getByLabelText("Add tag");
    fireEvent.change(input, { target: { value: "Zzz Tag" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(getLibraryIcon("play")?.tags).toEqual(["music", "zzz-tag"]);
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        ICON_TAGS_ENDPOINT,
        expect.objectContaining({
          body: JSON.stringify({ id: "play", tags: ["music", "zzz-tag"] }),
        }),
      );
    });
    await waitFor(() => {
      expect(within(detail).getByText("Saved to iconTags.json")).toBeTruthy();
    });

    fireEvent.click(
      within(detail).getByRole("button", { name: "Remove tag music" }),
    );
    expect(getLibraryIcon("play")?.tags).toEqual(["zzz-tag"]);
  });

  it("surfaces a save failure", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      statusText: "Server Error",
      json: () => Promise.resolve({ error: "disk full" }),
    });
    render(<IconLabShell />);
    fireEvent.click(tile("play"));
    const detail = screen.getByRole("complementary", { name: "Selected icon" });
    const input = within(detail).getByLabelText("Add tag");
    fireEvent.change(input, { target: { value: "zzz" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => {
      expect(within(detail).getByText("Not saved: disk full")).toBeTruthy();
    });
  });

  it("offers the icon picker for the selected icon", () => {
    render(<IconLabShell />);
    fireEvent.click(tile("pause"));
    expect(screen.getByRole("button", { name: /Pause/ })).toBeTruthy();
  });
});
