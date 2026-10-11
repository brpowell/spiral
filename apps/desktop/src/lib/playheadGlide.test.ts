import { describe, expect, it, vi } from "vitest";
import { createPlayheadGlide, playheadRatio } from "./playheadGlide";

function fakeTarget() {
  const cancel = vi.fn();
  const animate = vi.fn(() => ({ cancel }) as unknown as Animation);
  const el = { style: { transform: "" }, animate } as unknown as HTMLElement;
  return { el, animate, cancel, transform: (r: number) => `scaleX(${r})` };
}

describe("playheadRatio", () => {
  it("clamps and guards zero duration", () => {
    expect(playheadRatio(5, 10)).toBe(0.5);
    expect(playheadRatio(20, 10)).toBe(1);
    expect(playheadRatio(-1, 10)).toBe(0);
    expect(playheadRatio(5, 0)).toBe(0);
  });
});

describe("createPlayheadGlide", () => {
  it("animates to the end of the track while playing", () => {
    const target = fakeTarget();
    const glide = createPlayheadGlide([target], { nowMs: () => 0 });
    glide.sync(25, 100, true);

    expect(target.el.style.transform).toBe("scaleX(0.25)");
    expect(target.animate).toHaveBeenCalledWith(
      [{ transform: "scaleX(0.25)" }, { transform: "scaleX(1)" }],
      { duration: 75_000, easing: "linear", fill: "forwards" },
    );
  });

  it("keeps the running animation when the clock agrees", () => {
    let now = 0;
    const target = fakeTarget();
    const glide = createPlayheadGlide([target], { nowMs: () => now });
    glide.sync(10, 100, true);
    now = 1000;
    glide.sync(11.1, 100, true);

    expect(target.animate).toHaveBeenCalledTimes(1);
    expect(target.cancel).not.toHaveBeenCalled();
  });

  it("restarts after a seek", () => {
    let now = 0;
    const target = fakeTarget();
    const glide = createPlayheadGlide([target], { nowMs: () => now });
    glide.sync(10, 100, true);
    now = 1000;
    glide.sync(60, 100, true);

    expect(target.cancel).toHaveBeenCalledTimes(1);
    expect(target.animate).toHaveBeenCalledTimes(2);
    expect(target.el.style.transform).toBe("scaleX(0.6)");
  });

  it("stops and holds position when paused", () => {
    const target = fakeTarget();
    const glide = createPlayheadGlide([target], { nowMs: () => 0 });
    glide.sync(10, 100, true);
    glide.sync(12, 100, false);

    expect(target.cancel).toHaveBeenCalledTimes(1);
    expect(target.animate).toHaveBeenCalledTimes(1);
    expect(target.el.style.transform).toBe("scaleX(0.12)");
  });

  it("does not animate when motion is disabled", () => {
    const target = fakeTarget();
    const glide = createPlayheadGlide([target], { animate: false });
    glide.sync(10, 100, true);

    expect(target.animate).not.toHaveBeenCalled();
    expect(target.el.style.transform).toBe("scaleX(0.1)");
  });

  it("cancels on dispose", () => {
    const target = fakeTarget();
    const glide = createPlayheadGlide([target], { nowMs: () => 0 });
    glide.sync(10, 100, true);
    glide.dispose();

    expect(target.cancel).toHaveBeenCalledTimes(1);
  });
});
