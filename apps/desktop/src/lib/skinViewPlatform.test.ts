import { describe, expect, it } from "vitest";
import { parseSkinAuxWindowLabel, skinAuxWindowLabel } from "./skinAuxContext";
import {
  canSwitchView,
  isAuxiliaryView,
  isExclusiveView,
  isPrimaryView,
  primaryViewId,
  resolveViewDragInference,
} from "./skinWindowPresentation";
import { resolveViewWindowChrome } from "./skinModeWindowChrome";
import type { LoadedSkinPack } from "../types/skin";

function makePack(views: LoadedSkinPack["manifest"]["views"]): LoadedSkinPack {
  return {
    summary: {
      id: "t3",
      name: "T3",
      author: "Test",
      description: "",
      isBuiltin: true,
      authorId: "spiral",
      version: "1.0.0",
      zone: "builtin",
      previewPath: null,
    },
    packDir: "/tmp/t3",
    manifest: {
      id: "t3",
      name: "T3",
      author: "Test",
      description: "",
      views,
    },
  };
}

describe("skinAuxContext", () => {
  it("round-trips window labels", () => {
    expect(skinAuxWindowLabel("t3", "eq")).toBe("skin-aux-t3_eq");
    expect(parseSkinAuxWindowLabel("skin-aux-t3_eq")).toEqual({
      skinId: "t3",
      viewId: "eq",
    });
  });

  it("encodes dots in pack contribution ids for Tauri labels", () => {
    expect(skinAuxWindowLabel("spiral.xbox.skin.xbox", "playlist")).toBe(
      "skin-aux-spiral:xbox:skin:xbox_playlist",
    );
    expect(
      parseSkinAuxWindowLabel("skin-aux-spiral:xbox:skin:xbox_playlist"),
    ).toEqual({
      skinId: "spiral.xbox.skin.xbox",
      viewId: "playlist",
    });
  });
});

describe("skinWindowPresentation", () => {
  const pack = makePack({
    main: {
      presentation: "primary",
      layout: { type: "column", children: [] },
    },
    mini: {
      presentation: "exclusive",
      layout: { type: "column", children: [] },
    },
    eq: {
      presentation: "auxiliary",
      layout: { type: "column", children: [] },
    },
  });

  it("classifies view presentations", () => {
    expect(primaryViewId(pack.manifest.views)).toBe("main");
    expect(isPrimaryView(pack, "main")).toBe(true);
    expect(isExclusiveView(pack, "mini")).toBe(true);
    expect(isAuxiliaryView(pack, "eq")).toBe(true);
    expect(canSwitchView(pack, "mini")).toBe(true);
    expect(canSwitchView(pack, "eq")).toBe(false);
  });

  it("assumes primary when a skin has one view", () => {
    const solo = makePack({
      standard: { layout: { type: "column", children: [] } },
    });
    expect(primaryViewId(solo.manifest.views)).toBe("standard");
    expect(isPrimaryView(solo, "standard")).toBe(true);
  });

  it("resolves drag inference defaults and overrides", () => {
    const flowView = { layout: { type: "column" as const, children: [] } };
    expect(resolveViewDragInference(flowView)).toBe("manual");

    const canvasView = {
      layout: { type: "canvas" as const, width: 100, height: 80, children: [] },
    };
    expect(resolveViewDragInference(canvasView)).toBe("auto");

    expect(
      resolveViewDragInference({
        ...canvasView,
        dragInference: "manual" as const,
      }),
    ).toBe("manual");
  });
});

describe("resolveViewWindowChrome", () => {
  it("reads window constraints from the view", () => {
    const pack = makePack({
      main: {
        layout: { type: "column", children: [] },
        window: {
          defaultWidth: 317,
          defaultHeight: 330,
          resizable: false,
        },
      },
    });

    const chrome = resolveViewWindowChrome(pack, "main");
    expect(chrome.defaultWidth).toBe(317);
    expect(chrome.defaultHeight).toBe(330);
    expect(chrome.resizable).toBe(false);
  });

  it("leaves max dimensions unbounded when omitted", () => {
    const pack = makePack({
      playlist: {
        layout: { type: "column", children: [] },
        window: {
          defaultWidth: 279,
          defaultHeight: 245,
          resizable: true,
        },
      },
    });

    const chrome = resolveViewWindowChrome(pack, "playlist");
    expect(chrome.maxWidth).toBeUndefined();
    expect(chrome.maxHeight).toBeUndefined();
  });

  it("applies explicit max dimensions from the view", () => {
    const pack = makePack({
      main: {
        layout: { type: "column", children: [] },
        window: {
          defaultWidth: 317,
          defaultHeight: 330,
          maxWidth: 317,
          maxHeight: 330,
        },
      },
    });

    const chrome = resolveViewWindowChrome(pack, "main");
    expect(chrome.maxWidth).toBe(317);
    expect(chrome.maxHeight).toBe(330);
  });

  it("honors min larger than the WMS default size", () => {
    const pack = makePack({
      infoview: {
        layout: { type: "column", children: [] },
        window: {
          defaultWidth: 376,
          defaultHeight: 216,
          minWidth: 437,
          minHeight: 304,
          resizable: true,
        },
      },
    });

    const chrome = resolveViewWindowChrome(pack, "infoview");
    expect(chrome.minWidth).toBe(437);
    expect(chrome.minHeight).toBe(304);
    expect(chrome.defaultWidth).toBe(437);
    expect(chrome.defaultHeight).toBe(304);
  });
});
