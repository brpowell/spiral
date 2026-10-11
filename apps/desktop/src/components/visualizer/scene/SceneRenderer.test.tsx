import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SceneRenderer } from "./SceneRenderer";

vi.mock("../context", () => ({
  usePrefersReducedMotion: () => true,
  useVisualizerContextBuilder: () => () => ({
    scene: "default",
    size: { width: 0, height: 0, dpr: 1 },
    audio: {
      bins: [],
      isPlaying: false,
      playbackState: "stopped",
      volume: 1,
      overallEnergy: 0,
      bassEnergy: 0,
      midEnergy: 0,
      trebleEnergy: 0,
    },
    bind: () => undefined,
    theme: { name: "Obsidian", tokens: {} },
    flags: { reducedMotion: true },
    trackMetadata: {
      id: null,
      title: "",
      album: null,
      artists: [],
      art: null,
      artColors: [],
    },
  }),
}));

vi.mock("../sandbox/SandboxedVizRenderer", () => ({
  SandboxedVizRenderer: class {
    static create() {
      return new Promise(() => {});
    }
  },
}));

interface Observation {
  callback: ResizeObserverCallback;
  target: Element;
}

const observations: Observation[] = [];
const sceneSize = { width: 900, height: 500 };
const bodyRect = {
  x: 0,
  y: 64,
  top: 64,
  left: 0,
  right: 900,
  bottom: 564,
  width: 900,
  height: 500,
  toJSON() {
    return {};
  },
};

class RecordingResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}

  observe(target: Element) {
    observations.push({ callback: this.callback, target });
  }

  unobserve() {}

  disconnect() {}
}

function notify(className: string) {
  for (const entry of observations) {
    if (!entry.target.isConnected) continue;
    if (!entry.target.classList.contains(className)) continue;
    entry.callback([], entry as unknown as ResizeObserver);
  }
}

describe("SceneRenderer expanded resize", () => {
  const nativeWidth = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "clientWidth",
  )?.get;
  const nativeHeight = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "clientHeight",
  )?.get;

  afterEach(() => {
    observations.length = 0;
    document.querySelector(".app-body")?.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("resizes the scene when the window frame changes", () => {
    sceneSize.width = 900;
    sceneSize.height = 500;
    bodyRect.right = 900;
    bodyRect.bottom = 564;
    bodyRect.width = 900;
    bodyRect.height = 500;

    vi.stubGlobal("ResizeObserver", RecordingResizeObserver);
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => {});

    if (nativeWidth && nativeHeight) {
      vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(
        function (this: HTMLElement) {
          return this.classList.contains("scene-viewport")
            ? sceneSize.width
            : nativeWidth.call(this);
        },
      );
      vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(
        function (this: HTMLElement) {
          return this.classList.contains("scene-viewport")
            ? sceneSize.height
            : nativeHeight.call(this);
        },
      );
    }

    const appBody = document.createElement("div");
    appBody.className = "app-body";
    document.body.appendChild(appBody);
    vi.spyOn(appBody, "getBoundingClientRect").mockImplementation(
      () => bodyRect as DOMRect,
    );

    render(
      <SceneRenderer
        scene={[{ kind: "canvas", layout: "fill", entry: "index.js" }]}
        visualizerId="spiral.core.visualizer.bars"
        variant="mini"
        expanded
        showExpandToggle={false}
      />,
    );

    const anchor = document.querySelector(".audio-visualizer-anchor--expanded");
    const viewport = document.querySelector(".scene-viewport");
    const layer = document.querySelector(".scene-layer");
    const watchedViewport = observations.find((entry) =>
      entry.target.classList.contains("scene-viewport"),
    );

    expect(anchor).toHaveStyle({ width: "900px", height: "500px" });
    expect(layer).toHaveStyle({ width: "900px", height: "500px" });
    expect(watchedViewport?.target).toBe(viewport);
    expect(watchedViewport?.target.isConnected).toBe(true);

    sceneSize.width = 1200;
    sceneSize.height = 700;
    bodyRect.right = 1200;
    bodyRect.bottom = 764;
    bodyRect.width = 1200;
    bodyRect.height = 700;

    act(() => {
      notify("app-body");
      notify("scene-viewport");
    });

    expect(anchor).toHaveStyle({ width: "1200px", height: "700px" });
    expect(layer).toHaveStyle({ width: "1200px", height: "700px" });
  });
});
