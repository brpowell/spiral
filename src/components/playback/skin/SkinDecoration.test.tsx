import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DecorationNode, LoadedSkinPack } from "../../../types/skin";
import { SkinDecoration } from "./SkinDecoration";

const viewState: Record<string, string> = { shutter: "shut" };

vi.mock("../../../lib/skinBinds", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/skinBinds")>(
    "../../../lib/skinBinds",
  );
  return { ...actual, useSkinBindState: () => ({ viewState }) };
});

const loadSkinBitmap = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const getSkinBitmapIfReady = vi.hoisted(() => vi.fn(() => undefined));

vi.mock("../../../lib/skinBitmapCache", () => ({
  isSkinBitmapReady: () => true,
  getSkinBitmapIfReady,
  loadSkinBitmap,
}));

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
}));

const decoded = new Map<string, object>();

vi.mock("../../../lib/skinGifPlayback", () => ({
  getDecodedSkinGif: (url: string) => decoded.get(url),
  loadSkinGif: () => new Promise(() => {}),
  // Deliberately never reports onFirstFrameDrawn, so visibility can only come
  // from the synchronous cache hit.
  playSkinGifOnCanvas: () => ({ stop: () => {} }),
}));

const pack = { packDir: "/packs/demo" } as LoadedSkinPack;

function bitmapNode(): DecorationNode {
  return {
    id: "shutter-hold",
    type: "decoration",
    bounds: { x: 0, y: 0, w: 16, h: 16 },
    presentation: {
      kind: "bitmap",
      assets: { default: "hold-idle.png" },
      assetsWhen: {
        "state.shutter.shut": { default: "hold-shut.png" },
        "state.shutter.aperture": { default: "hold-aperture.png" },
      },
    },
  };
}

function gifNode(): DecorationNode {
  return {
    id: "shutter-iris-open",
    type: "decoration",
    bounds: { x: 0, y: 0, w: 16, h: 16 },
    presentation: { kind: "gif", asset: "iris-open.gif", durationMs: 100 },
  };
}

describe("SkinDecoration gif", () => {
  it("paints a preloaded gif in the mounting commit", () => {
    decoded.set("asset:///packs/demo/assets/iris-open.gif", { frames: [] });
    const { container } = render(
      <SkinDecoration node={gifNode()} pack={pack} />,
    );
    expect(container.querySelector("canvas")).toHaveStyle({ opacity: "1" });
  });

  it("stays hidden until the first frame of an undecoded gif is drawn", () => {
    decoded.clear();
    const { container } = render(
      <SkinDecoration node={gifNode()} pack={pack} />,
    );
    expect(container.querySelector("canvas")).toHaveStyle({ opacity: "0" });
  });
});

describe("SkinDecoration bitmap", () => {
  afterEach(() => {
    viewState.shutter = "shut";
  });

  it("resolves assetsWhen against view state", () => {
    const { container } = render(
      <SkinDecoration node={bitmapNode()} pack={pack} />,
    );
    expect(container.querySelector("canvas")).toHaveAttribute(
      "data-asset-url",
      "asset:///packs/demo/assets/hold-shut.png",
    );
  });

  it("falls back to the default asset when no bind matches", () => {
    viewState.shutter = "preroll";
    const { container } = render(
      <SkinDecoration node={bitmapNode()} pack={pack} />,
    );
    expect(container.querySelector("canvas")).toHaveAttribute(
      "data-asset-url",
      "asset:///packs/demo/assets/hold-idle.png",
    );
  });

  it("preloads every assetsWhen bitmap on mount", () => {
    loadSkinBitmap.mockClear();
    render(<SkinDecoration node={bitmapNode()} pack={pack} />);
    expect(loadSkinBitmap).toHaveBeenCalledWith(
      "asset:///packs/demo/assets/hold-idle.png",
    );
    expect(loadSkinBitmap).toHaveBeenCalledWith(
      "asset:///packs/demo/assets/hold-shut.png",
    );
    expect(loadSkinBitmap).toHaveBeenCalledWith(
      "asset:///packs/demo/assets/hold-aperture.png",
    );
  });
});
