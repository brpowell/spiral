import { fireEvent, render, screen } from "@testing-library/react";
import { useRef, type ReactNode, type Ref } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { releasedOutsidePanel } from "../../../lib/modalBackdropDismiss";
import { resetModalStack } from "../../../lib/modalStack";
import { useContextMenu } from "../../../hooks/useContextMenu";
import { ContextMenu, ContextMenuItem } from "../../ContextMenu/ContextMenu";
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

  it("does not close when the press lands on the click-through title bar", () => {
    const { onClose, backdrop } = renderOpenModal();
    const titlebar = document.createElement("div");
    document.body.append(titlebar);

    try {
      fireEvent.mouseDown(titlebar);
      fireEvent.mouseUp(titlebar);
      fireEvent.mouseDown(titlebar);
      fireEvent.mouseUp(backdrop);

      expect(onClose).not.toHaveBeenCalled();
    } finally {
      titlebar.remove();
    }
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

  it("Escape closes an open context menu without dismissing the modal", () => {
    const onClose = vi.fn();

    function ModalWithMenu() {
      const triggerRef = useRef<HTMLButtonElement>(null);
      const { open, anchor, position, menuRef, toggleFromTrigger, closeMenu } =
        useContextMenu();

      return (
        <Modal open onClose={onClose} labelledBy="editor-title">
          <h2 id="editor-title">Editor</h2>
          <button
            ref={triggerRef}
            type="button"
            onClick={() =>
              toggleFromTrigger(triggerRef.current, { keyboard: true })
            }
          >
            Art
          </button>
          <ContextMenu
            open={open}
            anchor={anchor}
            position={position}
            menuRef={menuRef}
            focusFirstItem
          >
            <ContextMenuItem label="Choose from file" onClick={closeMenu} />
          </ContextMenu>
        </Modal>
      );
    }

    render(<ModalWithMenu />);
    fireEvent.click(screen.getByRole("button", { name: "Art" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole("menuitem"), { key: "Escape" });

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});

describe("Modal fitContent", () => {
  function mockLayout() {
    const keys = ["offsetHeight", "clientHeight"] as const;
    const previous = keys.map((key) => [
      key,
      Object.getOwnPropertyDescriptor(HTMLElement.prototype, key),
    ]) as [(typeof keys)[number], PropertyDescriptor | undefined][];

    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get() {
        const el = this as HTMLElement;
        if (!el.classList?.contains("modal-panel")) return 24;
        if (el.style.height === "auto") return 280;
        const inline = Number.parseFloat(el.style.height);
        return Number.isFinite(inline) ? inline : 400;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get() {
        const el = this as HTMLElement;
        return el.classList?.contains("modal-backdrop") ? 900 : 100;
      },
    });

    return () => {
      for (const [key, descriptor] of previous) {
        if (descriptor)
          Object.defineProperty(HTMLElement.prototype, key, descriptor);
        else Reflect.deleteProperty(HTMLElement.prototype, key);
      }
    };
  }

  it("sizes the panel to its content and pins the top edge", () => {
    const restore = mockLayout();
    try {
      render(
        <Modal open onClose={vi.fn()} fitContent>
          <div className="modal-body">Details</div>
        </Modal>,
      );

      const panel = document.querySelector(".modal-panel") as HTMLElement;
      expect(panel).toHaveClass("modal-panel--fit");
      expect(panel.style.height).toBe("280px");
      expect(panel.style.alignSelf).toBe("flex-start");
      expect(panel.style.marginTop).toBe("310px");
    } finally {
      restore();
    }
  });
});
