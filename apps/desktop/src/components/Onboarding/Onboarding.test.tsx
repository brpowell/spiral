import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useOnboardingStore } from "../../store/useOnboardingStore";
import {
  Onboarding,
  ONBOARDING_FADE_MS,
  ONBOARDING_HOLD_MS,
  ONBOARDING_START_DELAY_MS,
} from "./Onboarding";

describe("Onboarding", () => {
  let complete: (() => void) | undefined;
  let mountOptions: SpiralMotionOptions | undefined;
  const destroy = vi.fn();
  const play = vi.fn();
  const setSound = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    destroy.mockClear();
    play.mockClear();
    setSound.mockClear();
    complete = undefined;
    mountOptions = undefined;
    window.Spiral = {
      LogoReveal: {
        mount: (_el, options) => {
          mountOptions = options;
          complete = options?.onComplete;
          return {
            destroy,
            play,
            setSound,
          } as unknown as SpiralMotionController;
        },
      },
    };
    useOnboardingStore.setState({ open: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    delete window.Spiral;
  });

  it("renders nothing when closed", () => {
    useOnboardingStore.setState({ open: false });
    render(<Onboarding />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("holds, fades, then finishes after the animation completes", () => {
    render(<Onboarding />);
    const overlay = screen.getByRole("dialog");
    expect(overlay.className).not.toContain("onboarding--leaving");

    act(() => complete?.());
    act(() => {
      vi.advanceTimersByTime(ONBOARDING_HOLD_MS);
    });
    expect(overlay.className).toContain("onboarding--leaving");
    expect(useOnboardingStore.getState().open).toBe(true);

    act(() => {
      vi.advanceTimersByTime(ONBOARDING_FADE_MS);
    });
    expect(useOnboardingStore.getState().open).toBe(false);
    expect(localStorage.getItem("spiral:onboardingCompleted")).toBe("1");
    expect(destroy).toHaveBeenCalled();
  });

  it("mounts paused with sound on, then plays after the start delay", () => {
    render(<Onboarding />);
    expect(mountOptions?.sound).toBe(true);
    expect(mountOptions?.autoplay).toBe(false);
    expect(setSound).toHaveBeenCalledWith(true);
    expect(play).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(ONBOARDING_START_DELAY_MS);
    });
    expect(play).toHaveBeenCalledTimes(1);
  });

  it("does not trap the user if the motion bundle is missing", () => {
    delete window.Spiral;
    render(<Onboarding />);
    expect(useOnboardingStore.getState().open).toBe(false);
  });
});
