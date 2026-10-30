import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useOnboardingStore } from "../store/useOnboardingStore";
import {
  adoptOnboardingSplash,
  onboardingOverlayTop,
  showOnboardingSplash,
} from "./onboardingSplash";

describe("onboardingSplash", () => {
  const destroy = vi.fn();
  let complete: (() => void) | undefined;
  let svg: SVGSVGElement;

  beforeEach(() => {
    svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    complete = undefined;
    window.Spiral = {
      LogoReveal: {
        mount: (el, options) => {
          complete = options?.onComplete;
          el.appendChild(svg);
          return { destroy, element: svg } as unknown as SpiralMotionController;
        },
      },
    };
    useOnboardingStore.setState({ open: true });
  });

  afterEach(() => {
    adoptOnboardingSplash(document.createElement("div"), () => {});
    document.body.innerHTML = "";
    delete window.Spiral;
  });

  it("paints an overlay with the logo before React renders", () => {
    showOnboardingSplash();
    const overlay = document.querySelector(".onboarding");
    expect(overlay).not.toBeNull();
    expect(overlay?.contains(svg)).toBe(true);
  });

  it("covers the whole window, padding the logo below the bar's space", () => {
    showOnboardingSplash();
    const overlay = document.querySelector<HTMLElement>(".onboarding")!;
    // No top offset (the bar isn't rendered yet); padding does the offsetting.
    expect(overlay.style.top).toBe("");
    expect(overlay.style.paddingTop).toBe(onboardingOverlayTop());
  });

  it("does nothing when onboarding is not open", () => {
    useOnboardingStore.setState({ open: false });
    showOnboardingSplash();
    expect(document.querySelector(".onboarding")).toBeNull();
  });

  it("hands the running logo to React and removes the placeholder", () => {
    showOnboardingSplash();
    const host = document.createElement("div");
    const onComplete = vi.fn();
    const controller = adoptOnboardingSplash(host, onComplete);

    expect(controller).not.toBeNull();
    expect(host.contains(svg)).toBe(true);
    expect(document.querySelector(".onboarding")).toBeNull();

    complete?.();
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("reports a completion that happened before adoption", () => {
    showOnboardingSplash();
    complete?.();
    const onComplete = vi.fn();
    adoptOnboardingSplash(document.createElement("div"), onComplete);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("returns null when there is no splash to adopt", () => {
    expect(
      adoptOnboardingSplash(document.createElement("div"), vi.fn()),
    ).toBeNull();
  });
});
