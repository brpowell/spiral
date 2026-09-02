import { fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InputNode } from "../../../types/skin";
import { useSkinStore } from "../../../store/useSkinStore";
import { SkinInput } from "./SkinInput";

vi.mock("../../../lib/skinBinds", () => ({
  useSkinBindValue: () => null,
  useSkinBindState: () => ({ viewState: {}, hoveredNodeIds: new Set() }),
  useSkinControlEnabled: () => true,
  evaluateSkinCondition: () => false,
}));

function input(overrides: Partial<InputNode> = {}): InputNode {
  return {
    type: "input",
    id: "plSearchEdit",
    placeholder: "Search...",
    onChange: [{ action: "playlist.setFilter" }],
    ...overrides,
  };
}

afterEach(() => {
  useSkinStore.setState({ playlistFilterQuery: "", inputValues: {} });
});

describe("SkinInput", () => {
  it("does not set inline style keys when style is omitted", () => {
    const { container } = render(<SkinInput node={input()} />);
    const el = container.querySelector(".skin-input");
    expect(el).toBeTruthy();
    expect(el).not.toHaveAttribute("style");
  });

  it("applies declared color and fontSize as inline styles", () => {
    const { container } = render(
      <SkinInput
        node={input({
          style: { color: "rgb(193, 208, 231)", fontSize: 8 },
        })}
      />,
    );
    const el = container.querySelector(".skin-input");
    expect(el).toHaveStyle({
      color: "rgb(193, 208, 231)",
      fontSize: "8px",
    });
  });

  it("writes the node value and sets the playlist filter as you type", async () => {
    const { container } = render(<SkinInput node={input()} />);
    const el = container.querySelector("input") as HTMLInputElement;
    fireEvent.change(el, { target: { value: "Air" } });

    expect(useSkinStore.getState().inputValues.plSearchEdit).toBe("Air");
    expect(el).toHaveValue("Air");
    await waitFor(() => {
      expect(useSkinStore.getState().playlistFilterQuery).toBe("Air");
    });
  });
});
