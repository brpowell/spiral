import { act, fireEvent, render, screen } from "@testing-library/react";
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
    useOnboardingStore.setState({ open: true, step: 0 });
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

  function playThroughReveal() {
    act(() => complete?.());
    act(() => {
      vi.advanceTimersByTime(ONBOARDING_HOLD_MS);
    });
  }

  it("docks the logo and shows the first step after the reveal", () => {
    render(<Onboarding />);
    const overlay = screen.getByRole("dialog");
    expect(overlay.className).not.toContain("onboarding--docked");
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();

    playThroughReveal();

    expect(overlay.className).toContain("onboarding--docked");
    expect(
      screen.getByRole("heading", { name: "Where should your Spiral folder live?" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Skip welcome" }),
    ).toBeInTheDocument();
    // First step has nowhere to go back to.
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  });

  it("steps forward and back through the welcome screens", () => {
    render(<Onboarding />);
    playThroughReveal();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(
      screen.getByRole("heading", { name: "Try on a style" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(
      screen.getByRole("heading", { name: "You're in control" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(
      screen.getByRole("heading", { name: "Try on a style" }),
    ).toBeInTheDocument();
  });

  it("finishes after fading out when the last step is completed", () => {
    render(<Onboarding />);
    playThroughReveal();
    act(() => useOnboardingStore.setState({ step: 2 }));

    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    expect(screen.getByRole("dialog").className).toContain(
      "onboarding--leaving",
    );
    expect(useOnboardingStore.getState().open).toBe(true);

    act(() => {
      vi.advanceTimersByTime(ONBOARDING_FADE_MS);
    });
    expect(useOnboardingStore.getState().open).toBe(false);
    expect(localStorage.getItem("spiral:onboardingCompleted")).toBe("1");
    expect(destroy).toHaveBeenCalled();
  });

  it("skips straight out from any step", () => {
    render(<Onboarding />);
    playThroughReveal();

    fireEvent.click(screen.getByRole("button", { name: "Skip welcome" }));
    act(() => {
      vi.advanceTimersByTime(ONBOARDING_FADE_MS);
    });
    expect(useOnboardingStore.getState().open).toBe(false);
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
