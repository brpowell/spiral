import { act, fireEvent, render, screen } from "@testing-library/react";
import { type ReactNode, type Ref } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Tooltip } from "./Tooltip";

vi.mock("framer-motion", () => ({
  useReducedMotion: () => false,
  AnimatePresence: ({ children }: { children: ReactNode }) => children,
  motion: {
    div: ({
      children,
      ref,
      initial: _initial,
      animate: _animate,
      exit: _exit,
      transition: _transition,
      ...props
    }: {
      children?: ReactNode;
      ref?: Ref<HTMLDivElement>;
      initial?: unknown;
      animate?: unknown;
      exit?: unknown;
      transition?: unknown;
    } & React.HTMLAttributes<HTMLDivElement>) => (
      <div ref={ref} {...props}>
        {children}
      </div>
    ),
  },
}));

const OPEN_DELAY = 400;
const CLOSE_GRACE = 120;

function renderTooltip(props: Partial<Parameters<typeof Tooltip>[0]> = {}) {
  return render(
    <Tooltip content="Helpful hint" {...props}>
      <button type="button">Trigger</button>
    </Tooltip>,
  );
}

function hover(el: Element, pointerType = "mouse") {
  const event = new Event("pointerover", { bubbles: true });
  Object.defineProperty(event, "pointerType", { value: pointerType });
  fireEvent(el, event);
}

function unhover(el: Element) {
  const event = new Event("pointerout", { bubbles: true });
  Object.defineProperty(event, "pointerType", { value: "mouse" });
  fireEvent(el, event);
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe("Tooltip", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens after the hover delay and closes shortly after the pointer leaves", () => {
    renderTooltip();
    const trigger = screen.getByRole("button");

    hover(trigger);
    expect(screen.queryByRole("tooltip")).toBeNull();
    advance(OPEN_DELAY);
    expect(screen.getByRole("tooltip").textContent).toBe("Helpful hint");

    unhover(trigger);
    expect(screen.getByRole("tooltip")).toBeTruthy();
    advance(CLOSE_GRACE);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("does not open if the pointer leaves before the delay", () => {
    renderTooltip();
    const trigger = screen.getByRole("button");

    hover(trigger);
    advance(OPEN_DELAY - 100);
    unhover(trigger);
    advance(OPEN_DELAY);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("ignores touch input, which has no hover", () => {
    renderTooltip();
    hover(screen.getByRole("button"), "touch");
    advance(OPEN_DELAY * 2);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("opens immediately on keyboard focus and closes on blur", () => {
    renderTooltip();
    const trigger = screen.getByRole("button");

    act(() => trigger.focus());
    expect(screen.getByRole("tooltip")).toBeTruthy();

    act(() => trigger.blur());
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("closes on Escape without letting the key reach anything else", () => {
    const onOuterKeyDown = vi.fn();
    document.addEventListener("keydown", onOuterKeyDown);
    renderTooltip();
    act(() => screen.getByRole("button").focus());
    expect(screen.getByRole("tooltip")).toBeTruthy();

    fireEvent.keyDown(document.body, { key: "Escape" });

    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(onOuterKeyDown).not.toHaveBeenCalled();
    document.removeEventListener("keydown", onOuterKeyDown);
  });

  it("closes when something scrolls", () => {
    renderTooltip();
    act(() => screen.getByRole("button").focus());
    expect(screen.getByRole("tooltip")).toBeTruthy();

    fireEvent.scroll(document.body);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("stays open while the pointer is over the tooltip itself", () => {
    renderTooltip();
    const trigger = screen.getByRole("button");
    hover(trigger);
    advance(OPEN_DELAY);

    unhover(trigger);
    advance(CLOSE_GRACE / 2);
    hover(screen.getByRole("tooltip"));
    advance(CLOSE_GRACE * 2);
    expect(screen.getByRole("tooltip")).toBeTruthy();

    unhover(screen.getByRole("tooltip"));
    advance(CLOSE_GRACE);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("opens with no delay when another tooltip just closed", () => {
    const first = renderTooltip();
    act(() => screen.getByRole("button").focus());
    act(() => screen.getByRole("button").blur());
    first.unmount();

    renderTooltip();
    hover(screen.getByRole("button"));
    advance(0);
    expect(screen.getByRole("tooltip")).toBeTruthy();
  });

  it("describes the trigger while open, unless told not to", () => {
    const { unmount } = renderTooltip();
    const trigger = screen.getByRole("button");
    expect(trigger.hasAttribute("aria-describedby")).toBe(false);
    act(() => trigger.focus());
    expect(trigger.getAttribute("aria-describedby")).toBe(
      screen.getByRole("tooltip").id,
    );
    unmount();

    renderTooltip({ describeTrigger: false });
    const other = screen.getByRole("button");
    act(() => other.focus());
    expect(screen.getByRole("tooltip")).toBeTruthy();
    expect(other.hasAttribute("aria-describedby")).toBe(false);
  });

  it("does nothing when there is no content", () => {
    renderTooltip({ content: "" });
    const trigger = screen.getByRole("button");
    hover(trigger);
    act(() => trigger.focus());
    advance(OPEN_DELAY);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("keeps the trigger's own handlers and ref", () => {
    const onFocus = vi.fn();
    const ref = vi.fn();
    render(
      <Tooltip content="Hint">
        <button type="button" onFocus={onFocus} ref={ref}>
          Trigger
        </button>
      </Tooltip>,
    );

    act(() => screen.getByRole("button").focus());
    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(ref).toHaveBeenCalledWith(screen.getByRole("button"));
  });
});
