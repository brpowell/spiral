import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { t } from "../../lib/i18n";
import {
  adoptOnboardingSplash,
  mountLogoReveal,
} from "../../lib/onboardingSplash";
import { useOnboardingStore } from "../../store/useOnboardingStore";

/**
 * How long the glyph sits still before the reveal plays. Lets startup work
 * (library load, first render) settle so the animation doesn't stutter, and
 * gives the user a beat to take in the screen.
 */
export const ONBOARDING_START_DELAY_MS = 1000;
/** How long the finished lockup holds before the overlay fades away. */
export const ONBOARDING_HOLD_MS = 800;
/** Matches the `.onboarding` opacity transition. */
export const ONBOARDING_FADE_MS = 600;

/**
 * First-run overlay over the library: plays the Spiral logo reveal once, holds
 * on the lockup, then fades out. Shown on first launch and via
 * Developer → Start Onboarding.
 */
export function Onboarding() {
  const open = useOnboardingStore((s) => s.open);
  if (!open) return null;
  return <OnboardingOverlay />;
}

function OnboardingOverlay() {
  const finish = useOnboardingStore((s) => s.finish);
  const logoRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<SpiralMotionController | null>(null);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [leaving, setLeaving] = useState(false);

  // Layout effect: the glyph must be in the DOM in the same commit as the
  // overlay, so the first painted frame already has the brandmark.
  useLayoutEffect(() => {
    const host = logoRef.current;
    const onComplete = () => {
      holdTimerRef.current = setTimeout(
        () => setLeaving(true),
        ONBOARDING_HOLD_MS,
      );
    };
    // Prefer the splash painted before React rendered; otherwise mount fresh.
    const controller = host
      ? (adoptOnboardingSplash(host, onComplete) ??
        mountLogoReveal(host, onComplete))
      : null;
    if (!controller) {
      // Motion bundle unavailable: never trap the user behind the overlay.
      finish();
      return;
    }
    controllerRef.current = controller;

    return () => {
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
      controllerRef.current?.destroy();
      controllerRef.current = null;
    };
  }, [finish]);

  // Passive effect: runs after first paint, so audio setup and the start
  // delay never hold up the brandmark appearing.
  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    // Build the audio graph (reverb impulse etc.) while the glyph is still,
    // so it can't hitch the first frames of the animation.
    controller.setSound(true);
    const startTimer = setTimeout(
      () => controller.play(),
      ONBOARDING_START_DELAY_MS,
    );
    return () => clearTimeout(startTimer);
  }, [finish]);

  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(finish, ONBOARDING_FADE_MS);
    return () => clearTimeout(timer);
  }, [leaving, finish]);

  return (
    <div
      className={`onboarding${leaving ? " onboarding--leaving" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label={t("common:onboarding.ariaLabel")}
      data-tauri-drag-region
    >
      <div className="onboarding__logo" ref={logoRef} />
    </div>
  );
}
