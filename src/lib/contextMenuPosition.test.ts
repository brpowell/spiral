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
});
