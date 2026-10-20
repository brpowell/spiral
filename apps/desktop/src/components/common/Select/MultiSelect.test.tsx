import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { MultiSelect } from "./MultiSelect";

const OPTIONS = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta" },
];

function Harness({ onChange }: { onChange?: (v: string[]) => void }) {
  const [values, setValues] = useState<string[]>([]);
  return (
    <MultiSelect
      values={values}
      onChange={(next) => {
        setValues(next);
        onChange?.(next);
      }}
      options={OPTIONS}
      summary={values.length === 0 ? "Everything" : values.join(", ")}
      clearLabel="Clear"
      aria-label="Pick"
    />
  );
}

describe("MultiSelect", () => {
  it("shows the summary on the same trigger a Select uses", () => {
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Pick" });
    expect(trigger.className).toContain("select__trigger");
    expect(trigger.className).toContain("btn--secondary");
    expect(trigger.textContent).toBe("Everything");
  });

  it("toggles several values, keeps the menu open, and clears them", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Pick" }));

    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Alpha" }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Beta" }));
    expect(onChange).toHaveBeenLastCalledWith(["a", "b"]);
    expect(
      screen
        .getByRole("menuitemcheckbox", { name: "Alpha" })
        .getAttribute("aria-checked"),
    ).toBe("true");

    fireEvent.click(screen.getByRole("menuitem", { name: "Clear" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });
});
