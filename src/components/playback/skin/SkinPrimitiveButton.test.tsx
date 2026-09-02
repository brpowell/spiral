import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ButtonNode, LoadedSkinPack } from "../../../types/skin";
import { SkinPrimitiveButton } from "./SkinPrimitiveButton";

const invokeClick = vi.fn();

vi.mock("../../../lib/skinEffects", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../lib/skinEffects")>();
  return {
    ...actual,
    scheduleSkinEffects: (...args: unknown[]) => invokeClick(...args),
  };
});

vi.mock("../../../lib/skinModeAlwaysOnTop", () => ({
  useSkinModeAlwaysOnTop: () => false,
}));

vi.mock("../../../lib/skinBinds", () => ({
  evaluateSkinCondition: () => false,
  useSkinBindState: () => ({}),
  useSkinControlEnabled: () => true,
}));

vi.mock("../../../lib/skinTooltips", () => ({
  useSkinTooltip: () => "Playlist",
}));

vi.mock("../../../lib/skinSoundEffects", () => ({
  playSkinSound: vi.fn(),
  resolveSkinClickSound: () => undefined,
}));

vi.mock("../../../lib/skinAssets", () => ({
  skinAssetFileUrl: (_packDir: string, file: string) => `asset://${file}`,
}));

const pack = { packDir: "/packs/test" } as LoadedSkinPack;

const playlistToggle: ButtonNode = {
  type: "button",
  id: "playlist-toggle",
  onClick: [
    {
      action: "state.applyEvent",
      payload: { variable: "playlist", event: "toggle" },
    },
  ],
  presentation: { kind: "primitive", icon: "setList" },
};

describe("SkinPrimitiveButton", () => {
  beforeEach(() => {
    invokeClick.mockReset();
  });

  it("forwards onClick effects on click", () => {
    render(<SkinPrimitiveButton node={playlistToggle} pack={pack} />);
    fireEvent.click(screen.getByRole("button", { name: "Playlist" }));
    expect(invokeClick).toHaveBeenCalledWith(
      playlistToggle.onClick,
      expect.any(Function),
    );
  });

  it("renders a library icon", () => {
    const { container } = render(
      <SkinPrimitiveButton node={playlistToggle} pack={pack} />,
    );
    expect(container.querySelector("svg")).toBeTruthy();
    expect(screen.getByRole("button")).toHaveClass("btn--icon-only");
  });

  it("renders an asset icon", () => {
    const node: ButtonNode = {
      ...playlistToggle,
      presentation: { kind: "primitive", icon: "icons/custom.png" },
    };
    const { container } = render(
      <SkinPrimitiveButton node={node} pack={pack} />,
    );
    const img = container.querySelector("img.skin-primitive-btn__asset-icon");
    expect(img).toHaveAttribute("src", "asset://icons/custom.png");
  });

  it("renders no icon for an unknown library id and falls back to tooltip text", () => {
    const node: ButtonNode = {
      ...playlistToggle,
      presentation: { kind: "primitive", icon: "notAnIcon" },
    };
    const { container } = render(
      <SkinPrimitiveButton node={node} pack={pack} />,
    );
    expect(container.querySelector("svg")).toBeNull();
    expect(screen.getByRole("button")).toHaveTextContent("Playlist");
    expect(screen.getByRole("button")).toHaveClass("skin-primitive-btn--text");
  });

  it("renders explicit text without iconOnly", () => {
    const node: ButtonNode = {
      ...playlistToggle,
      presentation: { kind: "primitive", text: "Reset EQ" },
    };
    render(<SkinPrimitiveButton node={node} pack={pack} />);
    const button = screen.getByRole("button", { name: "Playlist" });
    expect(button).toHaveTextContent("Reset EQ");
    expect(button).not.toHaveClass("btn--icon-only");
  });

  it("renders icon and text together", () => {
    const node: ButtonNode = {
      ...playlistToggle,
      presentation: {
        kind: "primitive",
        icon: "setList",
        text: "Playlist",
      },
    };
    const { container } = render(
      <SkinPrimitiveButton node={node} pack={pack} />,
    );
    expect(container.querySelector("svg")).toBeTruthy();
    expect(screen.getByRole("button")).toHaveTextContent("Playlist");
    expect(screen.getByRole("button")).not.toHaveClass("btn--icon-only");
  });

  it("defaults to ghost and accepts an explicit variant", () => {
    const { rerender } = render(
      <SkinPrimitiveButton node={playlistToggle} pack={pack} />,
    );
    expect(screen.getByRole("button")).toHaveClass("btn--ghost");

    rerender(
      <SkinPrimitiveButton
        node={{
          ...playlistToggle,
          presentation: {
            kind: "primitive",
            icon: "setList",
            variant: "secondary",
          },
        }}
        pack={pack}
      />,
    );
    expect(screen.getByRole("button")).toHaveClass("btn--secondary");
  });

  it("renders variant plain as a chrome-less hit target, not an app Button", () => {
    const node: ButtonNode = {
      ...playlistToggle,
      presentation: { kind: "primitive", text: "reset", variant: "plain" },
    };
    render(<SkinPrimitiveButton node={node} pack={pack} />);
    const button = screen.getByRole("button");
    expect(button).toHaveClass("skin-primitive-btn--plain");
    expect(button).not.toHaveClass("skin-primitive-btn--text");
    expect(button).not.toHaveClass("btn");
    expect(button).not.toHaveClass("btn--ghost");
  });

  it("applies declared style as inline CSS beside presentation", () => {
    const node: ButtonNode = {
      ...playlistToggle,
      presentation: { kind: "primitive", text: "reset" },
      style: { color: "rgb(221, 221, 221)", fontSize: 9 },
    };
    render(<SkinPrimitiveButton node={node} pack={pack} />);
    expect(screen.getByRole("button")).toHaveStyle({
      color: "rgb(221, 221, 221)",
      fontSize: "9px",
    });
  });

  it("resolves the visualizer alias icon", () => {
    const node: ButtonNode = {
      ...playlistToggle,
      presentation: { kind: "primitive", icon: "visualizer" },
    };
    const { container } = render(
      <SkinPrimitiveButton node={node} pack={pack} />,
    );
    expect(container.querySelector("svg")).toBeTruthy();
  });
});
