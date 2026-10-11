import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { LoadedSkinPack, PlaylistNode } from "../../../types/skin";
import { SkinLayoutNode } from "./SkinLayoutNode";

vi.mock("../../../lib/skinBinds", () => ({
  useSkinVisible: () => true,
  useSkinControlEnabled: () => true,
  useSkinBindState: () => ({ viewState: {}, hoveredNodeIds: new Set() }),
  evaluateSkinCondition: () => false,
}));

vi.mock("../SkinPlaylistView/SkinPlaylistView", () => ({
  SkinPlaylistView: ({ node }: { node: PlaylistNode }) => (
    <div data-testid="skin-playlist-view" data-node-id={node.id} />
  ),
}));

vi.mock("../VisualizerSlot/VisualizerSlot", () => ({
  VisualizerSlot: ({
    style,
    nodeId,
  }: {
    style?: { backgroundColor?: string };
    nodeId?: string;
  }) => (
    <div data-testid="visualizer-slot" data-node-id={nodeId} style={style} />
  ),
}));

vi.mock("./SkinRating", () => ({
  SkinRating: ({ node }: { node: { id?: string } }) => (
    <div data-testid="skin-rating" data-node-id={node.id} />
  ),
}));

const pack = { packDir: "/packs/test" } as LoadedSkinPack;

describe("SkinLayoutNode", () => {
  it("renders an input node", () => {
    const { container } = render(
      <SkinLayoutNode
        node={{
          type: "input",
          id: "plSearchEdit",
          placeholder: "Search...",
          onChange: [{ action: "playlist.setFilter" }],
        }}
        pack={pack}
      />,
    );

    const el = container.querySelector(".skin-input");
    expect(el).toHaveAttribute("data-node-id", "plSearchEdit");
    expect(el).toHaveAttribute("placeholder", "Search...");
  });

  it("renders a playlist node", () => {
    render(
      <SkinLayoutNode
        node={{ type: "playlist", id: "pl-list", showArtwork: true }}
        pack={pack}
      />,
    );

    expect(screen.getByTestId("skin-playlist-view")).toHaveAttribute(
      "data-node-id",
      "pl-list",
    );
  });

  it("applies subview style as inline CSS", () => {
    const { container } = render(
      <SkinLayoutNode
        node={{
          type: "subview",
          id: "eq-panel",
          bounds: { x: 0, y: 0, w: 10, h: 10 },
          children: [],
          style: { backgroundColor: "rgb(40, 95, 3)" },
        }}
        pack={pack}
      />,
    );

    expect(container.querySelector(".skin-layout-node--subview")).toHaveStyle({
      backgroundColor: "rgb(40, 95, 3)",
    });
  });

  it("forwards visualizer node style to the slot", () => {
    render(
      <SkinLayoutNode
        node={{
          type: "visualizer",
          id: "visEffects",
          presentation: { kind: "css" },
          style: { backgroundColor: "#000055" },
        }}
        pack={pack}
      />,
    );

    expect(screen.getByTestId("visualizer-slot")).toHaveStyle({
      backgroundColor: "#000055",
    });
  });

  it("renders a rating node", () => {
    render(
      <SkinLayoutNode
        node={{
          type: "rating",
          id: "visRatingStars",
          presentation: { kind: "primitive" },
          style: { color: "#F5A623" },
        }}
        pack={pack}
      />,
    );

    expect(screen.getByTestId("skin-rating")).toHaveAttribute(
      "data-node-id",
      "visRatingStars",
    );
  });
});
