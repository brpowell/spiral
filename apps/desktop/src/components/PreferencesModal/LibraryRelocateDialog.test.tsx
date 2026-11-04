import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode, Ref } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetModalStack } from "../../lib/modalStack";
import { LibraryRelocateDialog } from "./LibraryRelocateDialog";

vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => children,
  motion: {
    div: ({
      children,
      ref,
      className,
      role,
    }: {
      children?: ReactNode;
      ref?: Ref<HTMLDivElement>;
      className?: string;
      role?: string;
    }) => (
      <div ref={ref} className={className} role={role}>
        {children}
      </div>
    ),
  },
}));

afterEach(() => {
  resetModalStack();
});

function renderDialog(onConfirm = vi.fn().mockResolvedValue(undefined)) {
  render(
    <LibraryRelocateDialog
      open
      title="Move Spiral folder?"
      primary={{ label: "Move Spiral folder here", mode: "move" }}
      secondary={{ label: "Start an empty Spiral folder", mode: "fresh" }}
      busy={false}
      onClose={vi.fn()}
      onConfirm={onConfirm}
    >
      <p>Or start a new, empty Spiral folder here.</p>
    </LibraryRelocateDialog>,
  );
  return onConfirm;
}

describe("LibraryRelocateDialog", () => {
  it("is wide enough for its three footer buttons", () => {
    renderDialog();
    const button = screen.getByRole("button", {
      name: "Move Spiral folder here",
    });
    expect(button.closest(".modal-panel")).toHaveClass("modal-panel--xl");
  });

  it("confirms with the mode of the button pressed", () => {
    const onConfirm = renderDialog();
    fireEvent.click(
      screen.getByRole("button", { name: "Start an empty Spiral folder" }),
    );
    expect(onConfirm).toHaveBeenCalledWith("fresh");
  });
});
