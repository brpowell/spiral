import { describe, expect, it, vi } from "vitest";
import { fitContextMenuPosition } from "./contextMenuPosition";

describe("fitContextMenuPosition", () => {
  it("flips above the input when opening below would overflow the viewport", () => {
    vi.stubGlobal("window", {
      innerWidth: 800,
      innerHeight: 600,
    });

    const inputTop = 520;
    const inputBottom = 552;
    const menuGap = 4;
    const menuWidth = 300;
    const menuHeight = 200;

    const position = fitContextMenuPosition(
      100,
      inputBottom + menuGap,
      menuWidth,
      menuHeight,
      { flipUpAlignBottomY: inputTop - menuGap },
    );

    expect(position.top).toBe(inputTop - menuGap - menuHeight);
    expect(position.top + menuHeight).toBeLessThanOrEqual(inputTop - menuGap);
  });

  it("align=end places the menu's right edge at the anchor X", () => {
    vi.stubGlobal("window", {
      innerWidth: 800,
      innerHeight: 600,
    });

    const position = fitContextMenuPosition(400, 100, 200, 120, {
      align: "end",
    });

    expect(position.left).toBe(200);
    expect(position.top).toBe(100);
  });

  it("align=start places the menu's left edge at the anchor X", () => {
    vi.stubGlobal("window", {
      innerWidth: 800,
      innerHeight: 600,
    });

    const position = fitContextMenuPosition(100, 80, 200, 120, {
      align: "start",
    });

    expect(position.left).toBe(100);
    expect(position.top).toBe(80);
  });

  it("vertical=above places the menu's bottom edge at the anchor Y", () => {
    vi.stubGlobal("window", {
      innerWidth: 800,
      innerHeight: 600,
    });

    const position = fitContextMenuPosition(100, 400, 200, 120, {
      align: "start",
      vertical: "above",
    });

    expect(position.left).toBe(100);
    expect(position.top).toBe(280);
  });

  it("vertical=above flips below when there is not enough room above", () => {
    vi.stubGlobal("window", {
      innerWidth: 800,
      innerHeight: 600,
    });

    const position = fitContextMenuPosition(100, 40, 200, 120, {
      align: "start",
      vertical: "above",
      flipDownAlignTopY: 56,
    });

    expect(position.top).toBe(56);
  });
});
