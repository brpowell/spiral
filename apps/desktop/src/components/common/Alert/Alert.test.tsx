import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Alert } from "./Alert";

describe("Alert", () => {
  it("renders with variant class and default status role for info", () => {
    const { container } = render(<Alert variant="info">Heads up</Alert>);
    expect(screen.getByRole("status")).toHaveTextContent("Heads up");
    expect(container.firstChild).toHaveClass("alert", "alert--info");
  });

  it("uses alert role for error by default", () => {
    render(<Alert variant="error">Something failed</Alert>);
    expect(screen.getByRole("alert")).toHaveTextContent("Something failed");
  });

  it("renders a decorative leading icon beside the message", () => {
    const { container } = render(
      <Alert variant="warning" icon={<svg data-testid="icon" />}>
        Careful
      </Alert>,
    );
    expect(container.firstChild).toHaveClass("alert--with-icon");
    expect(screen.getByTestId("icon").closest(".alert__icon")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Careful");
  });
});
