import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Select } from "./Select";

describe("Select", () => {
  it("shows a heading above the first option of each group", () => {
    render(
      <Select
        value="a"
        onChange={() => {}}
        aria-label="Pick"
        options={[
          { value: "a", label: "Alpha", group: "First" },
          { value: "b", label: "Beta", group: "First" },
          { value: "c", label: "Gamma", group: "Second" },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Pick" }));
    const headings = document.querySelectorAll(".context-menu__heading");
    expect([...headings].map((h) => h.textContent)).toEqual([
      "First",
      "Second",
    ]);
  });

  it("renders no headings when options have no group", () => {
    render(
      <Select
        value="a"
        onChange={() => {}}
        aria-label="Pick"
        options={[{ value: "a", label: "Alpha" }]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Pick" }));
    expect(document.querySelector(".context-menu__heading")).toBeNull();
  });
});
