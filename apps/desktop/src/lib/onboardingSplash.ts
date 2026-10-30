import "../vendor/spiral-motion/bundle.js";
import "../components/Onboarding/Onboarding.css";
import { useOnboardingStore } from "../store/useOnboardingStore";
import { t } from "./i18n";
import { usesCustomWindowChrome, usesMacOverlayChrome } from "./windowChrome";

/**
 * Where the overlay starts, so it sits below the window's title bar and leaves
 * it draggable (and the Windows/Linux min/max/close controls usable).
 */
export function onboardingOverlayTop(): string {
  if (usesMacOverlayChrome()) return "var(--mac-titlebar-height-library)";
  if (usesCustomWindowChrome()) return "var(--window-titlebar-height)";
  return "0px";
}

/**
 * Mounts the Spiral logo reveal paused on its first frame. Returns null when the
 * motion bundle isn't available.
 */
export function mountLogoReveal(
  host: HTMLElement,
  onComplete: () => void,
): SpiralMotionController | null {
  const reveal = window.Spiral?.LogoReveal;
  if (!reveal) return null;
  return reveal.mount(host, {
    label: t("menus:app.name"),
    sound: true,
    autoplay: false,
    onComplete,
  });
}

interface Splash {
  overlay: HTMLElement;
  controller: SpiralMotionController;
  complete: (() => void) | null;
  completed: boolean;
}

let splash: Splash | null = null;

/**
 * Paints the onboarding overlay (themed background + brandmark) straight into
 * the document, before React has rendered. Call it as soon as the theme is
 * applied: the remaining startup bootstraps are async and, on a reload, the
 * window is already visible while they run. `<Onboarding />` adopts it later.
 */
export function showOnboardingSplash(): void {
  if (splash || !useOnboardingStore.getState().open) return;

  const overlay = document.createElement("div");
  overlay.className = "onboarding";
  overlay.setAttribute("aria-hidden", "true");
  // Cover the whole window: the title bar isn't rendered yet, and the strip it
  // will occupy would otherwise show the bare page background. Padding keeps
  // the logo centred in the same area the React overlay (which sits below the
  // bar) will use, so the handoff doesn't move it.
  overlay.style.paddingTop = onboardingOverlayTop();
  const logo = document.createElement("div");
  logo.className = "onboarding__logo";
  overlay.appendChild(logo);
  document.body.appendChild(overlay);

  const next: Splash = {
    overlay,
    controller: null as unknown as SpiralMotionController,
    complete: null,
    completed: false,
  };
  const controller = mountLogoReveal(logo, () => {
    next.completed = true;
    next.complete?.();
  });
  if (!controller) {
    overlay.remove();
    return;
  }
  next.controller = controller;
  splash = next;
}

/**
 * Hands the early splash's logo to React: moves the running animation into
 * `host` and removes the placeholder overlay in the same synchronous step, so
 * nothing visibly changes. Returns null when no splash was shown.
 */
export function adoptOnboardingSplash(
  host: HTMLElement,
  onComplete: () => void,
): SpiralMotionController | null {
  if (!splash) return null;
  const adopted = splash;
  splash = null;
  host.appendChild(adopted.controller.element);
  adopted.overlay.remove();
  adopted.complete = onComplete;
  // Reduced motion can finish before React gets here.
  if (adopted.completed) onComplete();
  return adopted.controller;
}
