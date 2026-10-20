import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDefault, mockPick } = vi.hoisted(() => ({
  mockDefault: vi.fn(async (_type: string, name: string) => {
    const slug = name.toLowerCase().replace(/\s+/g, "-") || "theme";
    return `/Music/Spiral Library/Packs/themes/${slug}`;
  }),
  mockPick: vi.fn(async (): Promise<string | null> => null),
}));

vi.mock("../../lib/tauri", () => ({
  defaultNewItemLocation: mockDefault,
  pickNewItemFolder: mockPick,
}));

import { NewThemeModal } from "./NewThemeModal";

function setup() {
  const onCreate = vi.fn();
  render(
    <NewThemeModal
      open
      creating={false}
      onClose={vi.fn()}
      onCreate={onCreate}
    />,
  );
  return { onCreate };
}

const nameInput = () => screen.getAllByRole("textbox")[0] as HTMLInputElement;
const locationInput = () =>
  screen.getAllByRole("textbox")[1] as HTMLInputElement;

describe("NewThemeModal", () => {
  beforeEach(() => vi.clearAllMocks());

  it("proposes a folder under the Spiral Library that follows the name", async () => {
    setup();
    fireEvent.change(nameInput(), { target: { value: "Night Owl" } });
    await waitFor(() =>
      expect(locationInput().value).toBe(
        "/Music/Spiral Library/Packs/themes/night-owl",
      ),
    );
  });

  it("leaves the location to the backend when it was not edited", async () => {
    const { onCreate } = setup();
    fireEvent.change(nameInput(), { target: { value: "Night Owl" } });
    await waitFor(() => expect(mockDefault).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(onCreate).toHaveBeenCalledWith({
      name: "Night Owl",
      location: undefined,
    });
  });

  it("sends an edited location and stops following the name", async () => {
    const { onCreate } = setup();
    fireEvent.change(locationInput(), { target: { value: "/tmp/my-theme" } });
    fireEvent.change(nameInput(), { target: { value: "Night Owl" } });
    await waitFor(() => expect(mockDefault).toHaveBeenCalled());
    expect(locationInput().value).toBe("/tmp/my-theme");
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(onCreate).toHaveBeenCalledWith({
      name: "Night Owl",
      location: "/tmp/my-theme",
    });
  });

  it("puts the theme in its own folder inside a picked folder", async () => {
    mockPick.mockResolvedValueOnce("/Users/bryan/Themes");
    setup();
    fireEvent.change(nameInput(), { target: { value: "Night Owl" } });
    await waitFor(() => expect(locationInput().value).toMatch(/night-owl$/));
    fireEvent.click(screen.getByRole("button", { name: "Browse…" }));
    await waitFor(() =>
      expect(locationInput().value).toBe("/Users/bryan/Themes/night-owl"),
    );
  });
});
