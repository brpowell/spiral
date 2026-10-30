import { useEffect, useRef, useState } from "react";
import { t } from "../../lib/i18n";
import { useOnboardingStore } from "../../store/useOnboardingStore";
import "../../vendor/spiral-motion/bundle.js";
import "./Onboarding.css";

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
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const host = logoRef.current;
    const reveal = window.Spiral?.LogoReveal;
    if (!host || !reveal) {
      // Motion bundle unavailable: never trap the user behind the overlay.
      finish();
      return;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = reveal.mount(host, {
      label: t("menus:app.name"),
      sound: true,
      onComplete: () => {
        timer = setTimeout(() => setLeaving(true), ONBOARDING_HOLD_MS);
      },
    });

    return () => {
      if (timer) clearTimeout(timer);
      controller.destroy();
    };
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
