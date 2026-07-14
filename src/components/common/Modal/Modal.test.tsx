import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode, Ref } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { releasedOutsidePanel } from "../../../lib/modalBackdropDismiss";
import { resetModalStack } from "../../../lib/modalStack";
import { Modal } from "./Modal";

vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => children,
  motion: {
    div: ({
      children,
      ref,
      className,
      role,
      "aria-modal": ariaModal,
      "aria-labelledby": ariaLabelledBy,
    }: {
      children?: ReactNode;
      ref?: Ref<HTMLDivElement>;
      className?: string;
      role?: string;
      "aria-modal"?: boolean;
      "aria-labelledby"?: string;
    }) => (
      <div
        ref={ref}
        className={className}
        role={role}
        aria-modal={ariaModal}
        aria-labelledby={ariaLabelledBy}
      >
        {children}
      </div>
    ),
  },
}));

function renderOpenModal(onClose = vi.fn()) {
  render(
    <Modal open onClose={onClose}>
      <input data-testid="field" aria-label="Year" />
    </Modal>,
  );
  return {
    onClose,
    field: screen.getByTestId("field"),
    backdrop: document.querySelector(".modal-backdrop") as HTMLElement,
    panel: document.querySelector(".modal-panel") as HTMLElement,
  };
}

describe("releasedOutsidePanel", () => {
  it("is true for the backdrop but false for panel descendants", () => {
    const backdrop = document.createElement("div");
    const panel = document.createElement("div");
    const input = document.createElement("input");
    const outside = document.createElement("div");

    backdrop.append(panel, outside);
    panel.append(input);

    expect(releasedOutsidePanel(backdrop, panel, outside)).toBe(true);
    expect(releasedOutsidePanel(backdrop, panel, input)).toBe(false);
    expect(releasedOutsidePanel(backdrop, panel, panel)).toBe(false);
  });
});

afterEach(() => {
  resetModalStack();
});

describe("Modal backdrop dismiss", () => {
  it("does not close when press starts inside the panel and release is on the backdrop", () => {
    const { onClose, field, backdrop } = renderOpenModal();

    fireEvent.mouseDown(field);
    fireEvent.mouseUp(backdrop);

    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes when press and release are both on the backdrop", () => {
    const { onClose, backdrop } = renderOpenModal();

    fireEvent.mouseDown(backdrop);
    fireEvent.mouseUp(backdrop);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not close when press starts on the backdrop but release is on the panel", () => {
    const { onClose, field, backdrop } = renderOpenModal();

    fireEvent.mouseDown(backdrop);
    fireEvent.mouseUp(field);

    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("Modal nested dismiss", () => {
  it("Escape closes only the topmost open modal", () => {
    const onCloseBottom = vi.fn();
    const onCloseTop = vi.fn();

    render(
      <>
        <Modal open onClose={onCloseBottom}>
          <span>Bottom</span>
        </Modal>
        <Modal open onClose={onCloseTop}>
          <span>Top</span>
        </Modal>
      </>,
    );

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onCloseTop).toHaveBeenCalledTimes(1);
    expect(onCloseBottom).not.toHaveBeenCalled();
  });

  it("backdrop click closes only the topmost open modal", () => {
    const onCloseBottom = vi.fn();
    const onCloseTop = vi.fn();

    render(
      <>
        <Modal open onClose={onCloseBottom}>
          <span>Bottom</span>
        </Modal>
        <Modal open onClose={onCloseTop}>
          <span>Top</span>
        </Modal>
      </>,
    );

    const backdrops = document.querySelectorAll(".modal-backdrop");
    const topBackdrop = backdrops[backdrops.length - 1] as HTMLElement;

    fireEvent.mouseDown(topBackdrop);
    fireEvent.mouseUp(topBackdrop);

    expect(onCloseTop).toHaveBeenCalledTimes(1);
    expect(onCloseBottom).not.toHaveBeenCalled();
  });
});
