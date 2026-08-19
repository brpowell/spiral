import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { LoadedSkinPack, PlaylistNode } from "../../../types/skin";
import { SkinLayoutNode } from "./SkinLayoutNode";

vi.mock("../../../lib/skinBinds", () => ({
  useSkinVisible: () => true,
}));

vi.mock("../SkinPlaylistView/SkinPlaylistView", () => ({
  SkinPlaylistView: ({ node }: { node: PlaylistNode }) => (
    <div data-testid="skin-playlist-view" data-node-id={node.id} />
  ),
}));

const pack = { packDir: "/packs/test" } as LoadedSkinPack;

describe("SkinLayoutNode", () => {
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
});
