import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "./Button";

describe("Button", () => {
  it("shows its content when idle", () => {
    render(<Button loadingLabel="Adding…">Add folder</Button>);
    const button = screen.getByRole("button", { name: "Add folder" });
    expect(button).toBeEnabled();
    expect(button.querySelector(".btn__spinner")).toBeNull();
  });

  it("swaps its content for the loading label", () => {
    render(
      <Button isLoading loadingLabel="Adding…">
        <svg data-testid="icon" />
        Add folder
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Adding…" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button.querySelector(".btn__spinner")).not.toBeNull();
    expect(screen.queryByTestId("icon")).toBeNull();
  });

  it("keeps its label without a loading label", () => {
    render(<Button isLoading>Save</Button>);
    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toHaveClass("btn--loading");
    expect(button).toBeDisabled();
  });
});
