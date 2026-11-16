import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AutocompleteInput } from "./AutocompleteInput";

const SUGGESTIONS = ["Rap Metal", "Metal", "Pop"];

function renderInput(openOnFocus?: boolean) {
  render(
    <AutocompleteInput
      value="Metal"
      suggestions={SUGGESTIONS}
      openOnFocus={openOnFocus}
      onChange={() => {}}
    />,
  );
  return screen.getByRole("combobox");
}

describe("AutocompleteInput", () => {
  it("opens its menu on focus by default", () => {
    const input = renderInput();
    act(() => input.focus());
    expect(screen.getByRole("option", { name: "Rap Metal" })).toBeTruthy();
  });

  it("with openOnFocus off, stays closed on focus", () => {
    const input = renderInput(false);
    act(() => input.focus());
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("with openOnFocus off, opens once the user types", () => {
    const input = renderInput(false);
    act(() => input.focus());
    fireEvent.change(input, { target: { value: "Meta" } });
    expect(screen.getByRole("listbox")).toBeTruthy();
  });

  it("with openOnFocus off, opens on an arrow key", () => {
    const input = renderInput(false);
    act(() => input.focus());
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getByRole("listbox")).toBeTruthy();
  });

  it("with openOnFocus off, closes and resets when focus leaves", async () => {
    const input = renderInput(false);
    act(() => input.focus());
    fireEvent.change(input, { target: { value: "Meta" } });
    expect(screen.getByRole("listbox")).toBeTruthy();
    act(() => input.blur());
    // The menu animates out, so it leaves the DOM a moment later.
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    act(() => input.focus());
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
