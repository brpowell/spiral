import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type FakeState = "running" | "suspended" | "closed" | "interrupted";

class FakeAudioContext {
  state: FakeState = "running";
  sampleRate = 44100;
  readonly close = vi.fn(async () => {
    this.state = "closed";
  });
  private readonly stateListeners = new Set<() => void>();

  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
  ): void {
    if (type !== "statechange") return;
    if (typeof listener === "function") {
      this.stateListeners.add(listener as () => void);
    }
  }

  setState(state: FakeState): void {
    this.state = state;
    for (const listener of this.stateListeners) listener();
  }
}

describe("pcmSharedContext sleep rebuild", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("AudioContext", FakeAudioContext);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function loadContext() {
    return import("./pcmSharedContext");
  }

  it("marks the graph for rebuild when WebKit interrupts it", async () => {
    const { getSharedPcmAudioContext, sharedPcmContextNeedsRebuild } =
      await loadContext();
    const ctx = getSharedPcmAudioContext() as unknown as FakeAudioContext;

    expect(sharedPcmContextNeedsRebuild()).toBe(false);
    ctx.setState("interrupted");
    expect(sharedPcmContextNeedsRebuild()).toBe(true);
  });

  it("keeps the old context open until the replacement graph is ready", async () => {
    const {
      getSharedPcmAudioContext,
      recreateSharedPcmAudioContextSync,
      closeReplacedPcmAudioContext,
      sharedPcmContextNeedsRebuild,
    } = await loadContext();
    const previous = getSharedPcmAudioContext() as unknown as FakeAudioContext;
    previous.setState("interrupted");

    const next = recreateSharedPcmAudioContextSync();

    expect(sharedPcmContextNeedsRebuild()).toBe(false);
    expect(next).not.toBe(previous);
    expect(previous.close).not.toHaveBeenCalled();

    closeReplacedPcmAudioContext();
    expect(previous.close).toHaveBeenCalledOnce();
  });
});
