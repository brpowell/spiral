import { beforeEach, describe, expect, it, vi } from "vitest";

const { nativeEnabled, native, pcm } = vi.hoisted(() => {
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
    onDrainAt: vi.fn(),
    onGaplessStarted: vi.fn(),
  });
  return {
    nativeEnabled: { value: false },
    native: { instances: [] as ReturnType<typeof makeEngine>[], makeEngine },
    pcm: { instances: [] as ReturnType<typeof makeEngine>[] },
  };
});

vi.mock("./nativeAudioFlag", () => ({
  isNativeAudioEnabled: () => nativeEnabled.value,
}));
vi.mock("./nativeFilePlaybackEngine", () => ({
  NativeFilePlaybackEngine: class {
    constructor() {
      const engine = native.makeEngine();
      native.instances.push(engine);
      return engine;
    }
  },
}));
vi.mock("./pcmFilePlaybackEngine", () => ({
  PcmFilePlaybackEngine: class {
    constructor() {
      const engine = native.makeEngine();
      pcm.instances.push(engine);
      return engine;
    }
  },
}));
vi.mock("./crossfadeController", () => ({}));

import { FilePlaybackEngine } from "./fileDeckEngine";

const SOURCE = { kind: "file" as const, path: "/a.flac" };

describe("FilePlaybackEngine", () => {
  beforeEach(() => {
    nativeEnabled.value = false;
    native.instances.length = 0;
    pcm.instances.length = 0;
  });

  it("creates no backend until a file loads", () => {
    const engine = new FilePlaybackEngine();
    engine.setDeckId("b");
    engine.setVolume(0.4);
    expect(native.instances).toHaveLength(0);
    expect(pcm.instances).toHaveLength(0);
    expect(engine.getVolume()).toBe(0.4);
    expect(engine.getPositionSeconds()).toBe(0);
    expect(engine.isPlaying()).toBe(false);
  });

  it("uses the webview backend when native output is off", async () => {
    const engine = new FilePlaybackEngine();
    await engine.load(SOURCE);
    expect(pcm.instances).toHaveLength(1);
    expect(native.instances).toHaveLength(0);
  });

  it("uses the native backend when the setting is on", async () => {
    nativeEnabled.value = true;
    const engine = new FilePlaybackEngine();
    await engine.load(SOURCE);
    expect(native.instances).toHaveLength(1);
    expect(pcm.instances).toHaveLength(0);
  });

  it("replays configuration made before the backend existed", async () => {
    nativeEnabled.value = true;
    const engine = new FilePlaybackEngine();
    const onEnd = vi.fn();
    engine.setDeckId("b");
    engine.setVolume(0.4);
    engine.setMuted(true);
    engine.setCrossfadeMix(0.5);
    engine.onEnd(onEnd);

    await engine.load(SOURCE);

    const backend = native.instances[0]!;
    expect(backend.setDeckId).toHaveBeenCalledWith("b");
    expect(backend.setVolume).toHaveBeenCalledWith(0.4);
    expect(backend.setMuted).toHaveBeenCalledWith(true);
    expect(backend.setCrossfadeMix).toHaveBeenCalledWith(0.5);
    expect(backend.onEnd).toHaveBeenCalledWith(onEnd);
  });

  it("keeps the backend across loads while the setting is unchanged", async () => {
    const engine = new FilePlaybackEngine();
    await engine.load(SOURCE);
    await engine.load(SOURCE);
    expect(pcm.instances).toHaveLength(1);
  });

  it("swaps backends when the setting changes between loads", async () => {
    const engine = new FilePlaybackEngine();
    await engine.load(SOURCE);
    nativeEnabled.value = true;
    await engine.load(SOURCE);
    expect(pcm.instances[0]!.destroy).toHaveBeenCalled();
    expect(native.instances).toHaveLength(1);
  });
});
