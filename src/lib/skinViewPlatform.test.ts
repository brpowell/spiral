import { describe, expect, it } from "vitest";
import {
  parseSkinAuxWindowLabel,
  skinAuxWindowLabel,
} from "./skinAuxContext";
import {
  canSwitchView,
  isAuxiliaryView,
  isExclusiveView,
  isPrimaryView,
  resolveViewDragInference,
  resolveViewPresentation,
} from "./skinWindowPresentation";
import {
  resolveViewWindowChrome,
} from "./skinModeWindowChrome";
import type { LoadedSkinPack } from "../types/skin";

function makePack(views: LoadedSkinPack["manifest"]["views"]): LoadedSkinPack {
  return {
    summary: {
      id: "t3",
      name: "T3",
      author: "Test",
      description: "",
      isBuiltin: true,
      previewPath: null,
    },
    packDir: "/tmp/t3",
    manifest: {
      version: 1,
      name: "T3",
      author: "Test",
      description: "",
      defaultView: "main",
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
    expect(isPrimaryView(pack, "main")).toBe(true);
    expect(isExclusiveView(pack, "mini")).toBe(true);
    expect(isAuxiliaryView(pack, "eq")).toBe(true);
    expect(canSwitchView(pack, "mini")).toBe(true);
    expect(canSwitchView(pack, "eq")).toBe(false);
  });

  it("defaults missing presentation from defaultView", () => {
    const legacy = makePack({
      standard: { layout: { type: "column", children: [] } },
      compact: { layout: { type: "column", children: [] } },
    });
    expect(resolveViewPresentation(
      legacy.manifest.views.standard,
      "standard",
      "standard",
    )).toBe("primary");
    expect(resolveViewPresentation(
      legacy.manifest.views.compact,
      "compact",
      "standard",
    )).toBe("exclusive");
  });

  it("resolves drag inference defaults and overrides", () => {
    const slotsView = { layout: { type: "column" as const, children: [] } };
    expect(resolveViewDragInference(slotsView)).toBe("manual");

    const canvasView = {
      layoutMode: "canvas" as const,
      layout: { type: "canvas" as const, children: [] },
    };
    expect(resolveViewDragInference(canvasView)).toBe("auto");

    expect(resolveViewDragInference({
      ...canvasView,
      dragInference: "manual" as const,
    })).toBe("manual");
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
});
