import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import {
  applyEqualizerState as applyNativeEqualizer,
  pushNativeEqualizer,
} from "./nativeEqualizer";

const BANDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
const STATE = {
  enabled: true,
  bands: BANDS,
  preampGain: -3,
} as unknown as Parameters<typeof applyNativeEqualizer>[0];

describe("native equalizer bridge", () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue(undefined);
  });

  it("sends bands and preamp in dB", () => {
    applyNativeEqualizer(STATE);
    expect(invoke).toHaveBeenCalledWith("set_native_equalizer", {
      enabled: true,
      bandsDb: [...BANDS],
      preampDb: -3,
    });
  });

  it("replays the remembered state on demand, e.g. when a session loads", () => {
    applyNativeEqualizer(STATE);
    invoke.mockClear();

    pushNativeEqualizer();

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0]![1]).toMatchObject({ preampDb: -3 });
  });

  it("is not affected by later mutation of the caller's array", () => {
    const bands = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    applyNativeEqualizer({ ...STATE, bands } as unknown as typeof STATE);
    bands[0] = 12;
    pushNativeEqualizer();
    expect((invoke.mock.calls[0]![1] as { bandsDb: number[] }).bandsDb[0]).toBe(
      0,
    );
  });
});
