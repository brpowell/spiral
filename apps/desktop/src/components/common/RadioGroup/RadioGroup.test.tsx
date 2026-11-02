import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RadioGroup, RadioGroupItem } from "./RadioGroup";

function Cards({
  value,
  onChange = vi.fn(),
}: {
  value: "a" | "b" | null;
  onChange?: (value: "a" | "b") => void;
}) {
  return (
    <RadioGroup
      variant="card"
      value={value}
      onChange={onChange}
      aria-label="Pick one"
    >
      <RadioGroupItem value="a" icon={<svg />} description="First option">
        Alpha
      </RadioGroupItem>
      <RadioGroupItem value="b" description="Second option">
        Beta
      </RadioGroupItem>
    </RadioGroup>
  );
}

describe("RadioGroup card variant", () => {
  it("uses real radios named by the title and described by the line under it", () => {
    render(<Cards value={null} />);
    const alpha = screen.getByRole("radio", { name: "Alpha" });
    expect(alpha).toHaveAccessibleDescription("First option");
    expect(alpha).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "Beta" })).not.toBeChecked();
    expect(screen.getByRole("radiogroup", { name: "Pick one" })).toBeVisible();
  });

  it("checks the current value and marks its card", () => {
    render(<Cards value="b" />);
    const beta = screen.getByRole("radio", { name: "Beta" });
    expect(beta).toBeChecked();
    expect(beta.closest("label")).toHaveClass("radio-group-item--checked");
  });

  it("reports the picked card", () => {
    const onChange = vi.fn();
    render(<Cards value={null} onChange={onChange} />);
    fireEvent.click(screen.getByText("Second option"));
    expect(onChange).toHaveBeenCalledWith("b");
  });
});
