import { describe, expect, it } from "vitest";
import { placeTooltip } from "./tooltipPosition";

const viewport = { width: 1000, height: 800 };
const tooltip = { width: 280, height: 90 };
const trigger = (left: number, top: number) => ({
  left,
  top,
  width: 26,
  height: 26,
});

describe("placeTooltip", () => {
  it("centers above the trigger with the gap between them", () => {
    const result = placeTooltip({
      trigger: trigger(487, 400),
      tooltip,
      viewport,
      placement: "top",
    });
    expect(result.placement).toBe("top");
    expect(result.left + tooltip.width / 2).toBe(487 + 13);
    expect(result.top + tooltip.height).toBe(400 - 8);
  });

  it("slides along the right edge instead of jumping away from the trigger", () => {
    // Regression: a menu-style flip put the tooltip a full width to the left of the trigger.
    const result = placeTooltip({
      trigger: trigger(960, 400),
      tooltip,
      viewport,
      placement: "top",
    });
    expect(result.left).toBe(viewport.width - tooltip.width - 8);
    // Still covers the trigger's horizontal span, so it reads as attached to it.
    expect(result.left).toBeLessThan(960);
    expect(result.left + tooltip.width).toBeGreaterThan(960 + 26);
  });

  it("slides along the left edge", () => {
    const result = placeTooltip({
      trigger: trigger(4, 400),
      tooltip,
      viewport,
      placement: "top",
    });
    expect(result.left).toBe(8);
  });

  it("flips below when there is no room above", () => {
    const result = placeTooltip({
      trigger: trigger(500, 40),
      tooltip,
      viewport,
      placement: "top",
    });
    expect(result.placement).toBe("bottom");
    expect(result.top).toBe(40 + 26 + 8);
  });

  it("flips above when a bottom placement has no room below", () => {
    const result = placeTooltip({
      trigger: trigger(500, 760),
      tooltip,
      viewport,
      placement: "bottom",
    });
    expect(result.placement).toBe("top");
    expect(result.top + tooltip.height).toBe(760 - 8);
  });

  it("takes the roomier side when neither fits, and stays on screen", () => {
    const tall = { width: 280, height: 700 };
    const result = placeTooltip({
      trigger: trigger(500, 300),
      tooltip: tall,
      viewport,
      placement: "top",
    });
    expect(result.top).toBeGreaterThanOrEqual(8);
    expect(result.top + tall.height).toBeLessThanOrEqual(viewport.height - 8);
  });

  it("stays at the padding when the tooltip is wider than the viewport", () => {
    const result = placeTooltip({
      trigger: trigger(100, 400),
      tooltip: { width: 1200, height: 50 },
      viewport,
      placement: "top",
    });
    expect(result.left).toBe(8);
  });
});
