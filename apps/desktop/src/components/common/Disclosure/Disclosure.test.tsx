import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Disclosure, DISCLOSURE_TRANSITION_MS } from "./Disclosure";

const region = (container: HTMLElement) =>
  container.querySelector(".disclosure__region") as HTMLElement;

describe("Disclosure", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("holds none of its content while closed", () => {
    const { container } = render(
      <Disclosure label="More">Hidden details</Disclosure>,
    );
    const trigger = screen.getByRole("button", { name: "More" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Hidden details")).toBeNull();
    // The region stays in the page for aria-controls, but out of reach.
    expect(trigger).toHaveAttribute("aria-controls", region(container).id);
    expect(region(container)).toHaveAttribute("inert");
    expect(region(container)).not.toHaveAttribute("data-open");
  });

  it("opens at once, and the region can then grow to its content", () => {
    const { container } = render(
      <Disclosure label="More">Hidden details</Disclosure>,
    );
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(screen.getByRole("button", { name: "More" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByText("Hidden details")).toBeInTheDocument();
    expect(region(container)).toHaveAttribute("data-open");
    expect(region(container)).not.toHaveAttribute("inert");
  });

  it("keeps the content while it closes, then lets it go", () => {
    const { container } = render(
      <Disclosure label="More" defaultOpen>
        Hidden details
      </Disclosure>,
    );
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    // Closing: out of reach straight away, but still there to shrink away.
    expect(region(container)).not.toHaveAttribute("data-open");
    expect(region(container)).toHaveAttribute("inert");
    expect(screen.getByText("Hidden details")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(DISCLOSURE_TRANSITION_MS - 1);
    });
    expect(screen.getByText("Hidden details")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText("Hidden details")).toBeNull();
  });

  it("keeps the content when reopened before it finished closing", () => {
    render(
      <Disclosure label="More" defaultOpen>
        Hidden details
      </Disclosure>,
    );
    const trigger = screen.getByRole("button", { name: "More" });
    fireEvent.click(trigger);
    act(() => {
      vi.advanceTimersByTime(DISCLOSURE_TRANSITION_MS / 2);
    });
    fireEvent.click(trigger);
    act(() => {
      vi.advanceTimersByTime(DISCLOSURE_TRANSITION_MS * 2);
    });
    expect(screen.getByText("Hidden details")).toBeInTheDocument();
  });

  it("follows a controlled open state and reports toggles", () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <Disclosure label="More" open={false} onOpenChange={onOpenChange}>
        Hidden details
      </Disclosure>,
    );
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(onOpenChange).toHaveBeenCalledWith(true);
    // Controlled: nothing opens until the parent says so.
    expect(screen.queryByText("Hidden details")).toBeNull();

    rerender(
      <Disclosure label="More" open onOpenChange={onOpenChange}>
        Hidden details
      </Disclosure>,
    );
    expect(screen.getByText("Hidden details")).toBeInTheDocument();
  });
});
