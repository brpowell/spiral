import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useOnboardingStore } from "../../store/useOnboardingStore";
import {
  Onboarding,
  ONBOARDING_FADE_MS,
  ONBOARDING_HOLD_MS,
  ONBOARDING_START_DELAY_MS,
} from "./Onboarding";

const tauri = vi.hoisted(() => ({
  createManagedSource: vi.fn(),
  removeSource: vi.fn(),
  listSources: vi.fn(),
  getSourceStatuses: vi.fn(),
  pickMusicFolder: vi.fn(),
  addSource: vi.fn(),
}));
vi.mock("../../lib/tauri", () => tauri);

const tracks = {
  id: 1,
  name: "Tracks",
  rootPath: "/Music/Spiral/Tracks",
  autoOrganize: true,
  pathFormat: null,
  importTarget: true,
  createdAt: "2026-01-01T00:00:00Z",
};

/** Next on the first step applies the answer, which is async. */
async function clickNext() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
  });
}

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
    useOnboardingStore.setState({
      open: true,
      step: 0,
      musicChoice: null,
      addedSourceIds: [],
      managedSourceId: null,
    });
    vi.clearAllMocks();
    tauri.listSources.mockResolvedValue([]);
    tauri.getSourceStatuses.mockResolvedValue([]);
    tauri.createManagedSource.mockResolvedValue(tracks);
    tauri.removeSource.mockResolvedValue(0);
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
      screen.getByRole("heading", {
        name: "How do you want your music organized?",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("You can always change this later."),
    ).toBeInTheDocument();
    // Next waits for an answer to the first question.
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Skip welcome" }),
    ).toBeInTheDocument();
    // First step has nowhere to go back to.
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  });

  it("steps through a new collection without a folders step", async () => {
    render(<Onboarding />);
    playThroughReveal();

    fireEvent.click(screen.getByRole("radio", { name: /^Use the default/ }));
    await clickNext();
    // Spiral manages a Tracks folder for a new collection.
    expect(tauri.createManagedSource).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("heading", { name: "Try on a style" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Step 2 of 3")).toBeInTheDocument();

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

  it("adds a folders step for music that's already organized", async () => {
    render(<Onboarding />);
    playThroughReveal();

    fireEvent.click(
      screen.getByRole("radio", {
        name: /^I'll pick the folder\(s\)/,
      }),
    );
    await clickNext();
    // Only the folders the user picks become sources: no Tracks.
    expect(tauri.createManagedSource).not.toHaveBeenCalled();
    expect(
      screen.getByRole("heading", { name: "Add music sources" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Step 2 of 4")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add folder" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(
      screen.getByRole("heading", { name: "Try on a style" }),
    ).toBeInTheDocument();
  });

  it("stays on the first step and says why when Tracks can't be made", async () => {
    tauri.createManagedSource.mockRejectedValue(
      "source_overlap: /Music/Spiral/Tracks overlaps /Music",
    );
    render(<Onboarding />);
    playThroughReveal();

    fireEvent.click(screen.getByRole("radio", { name: /^Use the default/ }));
    await clickNext();
    expect(screen.getByRole("alert").textContent).toMatch(
      /overlaps one of your sources/,
    );
    expect(
      screen.getByRole("heading", {
        name: "How do you want your music organized?",
      }),
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
