import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TextNode } from "../../../types/skin";
import { SkinText } from "./SkinText";

vi.mock("../../../lib/skinBinds", () => ({
  useSkinBindValue: () => null,
  useSkinBindState: () => ({ viewState: {}, hoveredNodeIds: new Set() }),
  evaluateSkinCondition: () => false,
}));

vi.mock("../../ScrollingText/ScrollingText", () => ({
  ScrollingText: ({ text }: { text: string }) => (
    <div className="scrolling-text">{text}</div>
  ),
}));

function text(overrides: Partial<TextNode> = {}): TextNode {
  return { type: "text", value: "Preset", ...overrides };
}

describe("SkinText", () => {
  it("does not set inline style keys when style is omitted", () => {
    const { container } = render(<SkinText node={text()} />);
    const el = container.querySelector(".skin-text");
    expect(el).toBeTruthy();
    expect(el).not.toHaveAttribute("style");
  });

  it("applies declared color, fontSize, and textAlign as inline styles", () => {
    const { container } = render(
      <SkinText
        node={text({
          style: {
            color: "rgb(70, 159, 229)",
            fontSize: 8,
            textAlign: "center",
          },
        })}
      />,
    );
    const el = container.querySelector(".skin-text");
    expect(el).toHaveStyle({
      color: "rgb(70, 159, 229)",
      fontSize: "8px",
      textAlign: "center",
    });
  });

  it("keeps idle scroll textAlign on the node root, not a pack :not(--active) selector", () => {
    const { container } = render(
      <SkinText
        node={text({
          id: "metadata",
          overflow: "scroll",
          style: { textAlign: "center" },
        })}
      />,
    );
    const el = container.querySelector(".skin-text");
    expect(el).toHaveAttribute("data-node-id", "metadata");
    expect(el).toHaveStyle({ textAlign: "center" });
  });
});
