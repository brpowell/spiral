import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SKIN_HOVER_RESIZE_QUIET_MS } from "./skinHover";
import type { SkinClickEffect } from "../types/skin";
import type { SkinBindState } from "./skinBinds";
import {
  SkinHoverProvider,
  useSkinHoveredNodeIds,
  useSkinHoverLeaveEffects,
  useSkinHoverPointerHandlers,
} from "./skinHoverContext";

const scheduleSkinEffects = vi.hoisted(() => vi.fn(() => () => {}));

vi.mock("./skinEffects", () => ({
  scheduleSkinEffects,
}));

function Probe() {
  const ids = useSkinHoveredNodeIds();
  const handlers = useSkinHoverPointerHandlers(["visFrame"], "t");
  return (
    <div
      data-testid="hit"
      data-active={[...ids].join(",")}
      onPointerEnter={handlers?.onPointerEnter}
      onPointerLeave={handlers?.onPointerLeave}
    />
  );
}

function renderProbe() {
  return render(
    <SkinHoverProvider>
      <Probe />
    </SkinHoverProvider>,
  );
}

function enterOver(hit: HTMLElement) {
  fireEvent.pointerEnter(hit);
}

describe("SkinHoverProvider resize quiet", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("clears hover on window resize and ignores enters until the quiet period ends", () => {
    vi.useFakeTimers();
    const { getByTestId } = renderProbe();
    const hit = getByTestId("hit");

    enterOver(hit);
    expect(hit).toHaveAttribute("data-active", "visFrame");

    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(hit).toHaveAttribute("data-active", "");

    enterOver(hit);
    expect(hit).toHaveAttribute("data-active", "");

    act(() => {
      vi.advanceTimersByTime(SKIN_HOVER_RESIZE_QUIET_MS);
    });
    enterOver(hit);
    expect(hit).toHaveAttribute("data-active", "visFrame");
  });
});

function VisibilityProbe({ active }: { active: boolean }) {
  const ids = useSkinHoveredNodeIds();
  const handlers = useSkinHoverPointerHandlers(["cMenuHotspot"], "t", active);
  return (
    <div
      data-testid="hit"
      data-active={[...ids].join(",")}
      onPointerEnter={handlers?.onPointerEnter}
      onPointerLeave={handlers?.onPointerLeave}
    />
  );
}

describe("useSkinHoverPointerHandlers visibility", () => {
  it("releases occupancy as soon as the node is hidden", () => {
    const { getByTestId, rerender } = render(
      <SkinHoverProvider>
        <VisibilityProbe active />
      </SkinHoverProvider>,
    );
    const hit = getByTestId("hit");
    enterOver(hit);
    expect(hit).toHaveAttribute("data-active", "cMenuHotspot");

    rerender(
      <SkinHoverProvider>
        <VisibilityProbe active={false} />
      </SkinHoverProvider>,
    );

    expect(getByTestId("hit")).toHaveAttribute("data-active", "");
  });
});

function LeaveProbe({ effects }: { effects?: SkinClickEffect[] }) {
  const handlers = useSkinHoverPointerHandlers(["cMenuHotspot"], "t");
  useSkinHoverLeaveEffects(
    "cMenuHotspot",
    effects,
    () => ({ viewState: {}, hoveredNodeIds: new Set() }) as SkinBindState,
  );
  return (
    <div
      data-testid="hit"
      onPointerEnter={handlers?.onPointerEnter}
      onPointerLeave={handlers?.onPointerLeave}
    />
  );
}

describe("useSkinHoverLeaveEffects", () => {
  afterEach(() => {
    vi.useRealTimers();
    scheduleSkinEffects.mockClear();
  });

  it("schedules onHoverLeave after the leave grace", () => {
    vi.useFakeTimers();
    const effects: SkinClickEffect[] = [
      {
        action: "view.applyStateEvent",
        payload: { variable: "menuMode", event: "collapse" },
      },
    ];
    const { getByTestId } = render(
      <SkinHoverProvider>
        <LeaveProbe effects={effects} />
      </SkinHoverProvider>,
    );
    const hit = getByTestId("hit");

    enterOver(hit);
    expect(scheduleSkinEffects).not.toHaveBeenCalled();

    fireEvent.pointerLeave(hit);
    expect(scheduleSkinEffects).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(scheduleSkinEffects).toHaveBeenCalledWith(
      effects,
      expect.any(Function),
    );
  });
});
