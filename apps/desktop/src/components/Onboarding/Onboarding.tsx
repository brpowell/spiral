import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  adoptOnboardingSplash,
  mountLogoReveal,
  onboardingOverlayTop,
} from "../../lib/onboardingSplash";
import {
  ONBOARDING_STEP_COUNT,
  useOnboardingStore,
} from "../../store/useOnboardingStore";
import { Button } from "../common/Button/Button";
import { FadingScroller } from "./FadingScroller";
import { LibraryStep } from "./steps/LibraryStep";
import { PrivacyStep } from "./steps/PrivacyStep";
import { StyleStep } from "./steps/StyleStep";

/**
 * How long the glyph sits still before the reveal plays. Lets startup work
 * (library load, first render) settle so the animation doesn't stutter, and
 * gives the user a beat to take in the screen.
 */
export const ONBOARDING_START_DELAY_MS = 1000;
/** How long the finished lockup holds before it docks into the corner. */
export const ONBOARDING_HOLD_MS = 800;
/** Length of the logo's shrink-and-move into the corner. */
export const ONBOARDING_DOCK_MS = 800;
/** Matches the `.onboarding` opacity transition. */
export const ONBOARDING_FADE_MS = 600;

/** `split`: text left, controls right. `centered`: one stacked, centred column (small settings). */
const STEPS = [
  { id: "library", Content: LibraryStep, layout: "centered" },
  { id: "style", Content: StyleStep, layout: "split" },
  { id: "privacy", Content: PrivacyStep, layout: "split" },
] as const;

/**
 * First-run overlay over the library: plays the Spiral logo reveal once, docks
 * the lockup into the corner, then walks through the welcome steps. Shown on
 * first launch and via Developer → Start Onboarding.
 */
export function Onboarding() {
  const open = useOnboardingStore((s) => s.open);
  if (!open) return null;
  return <OnboardingOverlay />;
}

function OnboardingOverlay() {
  const { t } = useTranslation("common");
  const finish = useOnboardingStore((s) => s.finish);
  const step = useOnboardingStore((s) => s.step);
  const next = useOnboardingStore((s) => s.next);
  const back = useOnboardingStore((s) => s.back);
  const logoRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<SpiralMotionController | null>(null);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const introRectRef = useRef<DOMRect | null>(null);
  const [docked, setDocked] = useState(false);
  const [leaving, setLeaving] = useState(false);
  // The first panel waits for the logo to dock; later steps appear right away.
  const [navigated, setNavigated] = useState(false);

  // Layout effect: the glyph must be in the DOM in the same commit as the
  // overlay, so the first painted frame already has the brandmark.
  useLayoutEffect(() => {
    const host = logoRef.current;
    const onComplete = () => {
      holdTimerRef.current = setTimeout(() => {
        // Remember where the finished lockup sits so the dock can animate from it.
        introRectRef.current = logoRef.current?.getBoundingClientRect() ?? null;
        setDocked(true);
      }, ONBOARDING_HOLD_MS);
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

  // FLIP the logo from the centred intro position into its docked corner:
  // the class change moved it (First → Last), so play it back from the old
  // rect with transforms only, which keeps it smooth and the SVG crisp.
  useLayoutEffect(() => {
    if (!docked) return;
    const el = logoRef.current;
    const first = introRectRef.current;
    if (!el || !first || typeof el.animate !== "function") return;
    const last = el.getBoundingClientRect();
    if (last.width === 0) return;
    const reduced = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduced) return;
    const from = `translate(${first.left - last.left}px, ${first.top - last.top}px) scale(${first.width / last.width})`;
    el.animate(
      [
        { transformOrigin: "top left", transform: from },
        { transformOrigin: "top left", transform: "none" },
      ],
      {
        duration: ONBOARDING_DOCK_MS,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
      },
    );
  }, [docked]);

  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(finish, ONBOARDING_FADE_MS);
    return () => clearTimeout(timer);
  }, [leaving, finish]);

  const isLast = step === ONBOARDING_STEP_COUNT - 1;
  const { id, Content, layout } = STEPS[step];

  return (
    <div
      className={[
        "onboarding",
        docked ? "onboarding--docked" : "",
        leaving ? "onboarding--leaving" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      role="dialog"
      aria-modal="true"
      aria-label={t("onboarding.ariaLabel")}
      style={{ top: onboardingOverlayTop() }}
    >
      <div className="onboarding__logo" ref={logoRef} />
      {docked ? (
        <>
          <div className="onboarding__skip">
            <Button variant="ghost" onClick={() => setLeaving(true)}>
              {t("onboarding.skip")}
            </Button>
          </div>
          <div
            className={`onboarding__panel onboarding__panel--${layout}${navigated ? "" : " onboarding__panel--first"}`}
            key={id}
          >
            <div className="onboarding__intro">
              <h1 className="onboarding__title">
                {t(`onboarding.${id}.title`)}
              </h1>
              <p className="onboarding__description">
                {t(`onboarding.${id}.description`)}
              </p>
            </div>
            <FadingScroller className="onboarding__content">
              <Content />
            </FadingScroller>
          </div>
          <footer className="onboarding__footer">
            <span className="onboarding__progress">
              {t("onboarding.progress", {
                current: step + 1,
                total: ONBOARDING_STEP_COUNT,
              })}
            </span>
            <div className="onboarding__nav">
              {step > 0 ? (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setNavigated(true);
                    back();
                  }}
                >
                  {t("onboarding.back")}
                </Button>
              ) : null}
              <Button
                variant="primary"
                onClick={
                  isLast
                    ? () => setLeaving(true)
                    : () => {
                        setNavigated(true);
                        next();
                      }
                }
              >
                {isLast ? t("onboarding.getStarted") : t("onboarding.next")}
              </Button>
            </div>
          </footer>
        </>
      ) : null}
    </div>
  );
}
