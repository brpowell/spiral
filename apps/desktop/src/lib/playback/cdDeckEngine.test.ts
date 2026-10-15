import { beforeEach, describe, expect, it, vi } from "vitest";

const { nativeEnabled, webview, native, makeEngine } = vi.hoisted(() => {
  const makeEngine = () => ({
    capabilities: {},
    load: vi.fn(async () => {}),
    destroy: vi.fn(),
    setDeckId: vi.fn(),
    setVolume: vi.fn(),
    setBalance: vi.fn(),
    setMuted: vi.fn(),
    setCrossfadeMix: vi.fn(),
    onEnd: vi.fn(),
    onError: vi.fn(),
    onDrainAt: vi.fn(),
    onGaplessStarted: vi.fn(),
  });
  return {
    nativeEnabled: { value: false },
    webview: { instances: [] as ReturnType<typeof makeEngine>[] },
    native: { instances: [] as ReturnType<typeof makeEngine>[] },
    makeEngine,
  };
});

vi.mock("./nativeAudioFlag", () => ({
  isNativeAudioEnabled: () => nativeEnabled.value,
}));
vi.mock("./nativeCdPlaybackEngine", () => ({
  NativeCdPlaybackEngine: class {
    constructor() {
      const engine = makeEngine();
      native.instances.push(engine);
      return engine;
    }
  },
}));
vi.mock("./cdPlaybackEngine", () => ({
  CdPlaybackEngine: class {
    constructor() {
      const engine = makeEngine();
      webview.instances.push(engine);
      return engine;
    }
  },
}));
vi.mock("./crossfadeController", () => ({}));

import { CdDeckEngine } from "./cdDeckEngine";

const TRACK = { kind: "cd" as const, driveId: "d", trackNumber: 1 };

describe("CdDeckEngine", () => {
  beforeEach(() => {
    nativeEnabled.value = false;
    webview.instances.length = 0;
    native.instances.length = 0;
  });

  it("uses the webview CD engine when native output is off", async () => {
    const engine = new CdDeckEngine();
    await engine.load(TRACK);
    expect(webview.instances).toHaveLength(1);
    expect(native.instances).toHaveLength(0);
  });

  it("uses the native CD engine when native output is on", async () => {
    nativeEnabled.value = true;
    const engine = new CdDeckEngine();
    await engine.load(TRACK);
    expect(native.instances).toHaveLength(1);
  });

  it("replays the error handler registered before the backend existed", async () => {
    nativeEnabled.value = true;
    const engine = new CdDeckEngine();
    const onError = vi.fn();
    engine.onError(onError);
    await engine.load(TRACK);
    expect(native.instances[0]!.onError).toHaveBeenCalledWith(onError);
  });

  it("forwards a handler set after the backend exists", async () => {
    const engine = new CdDeckEngine();
    await engine.load(TRACK);
    const onError = vi.fn();
    engine.onError(onError);
    expect(webview.instances[0]!.onError).toHaveBeenCalledWith(onError);
  });
});
