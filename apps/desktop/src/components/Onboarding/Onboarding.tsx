import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
} from "react";
import { useTranslation } from "react-i18next";
import {
  adoptOnboardingSplash,
  mountLogoReveal,
  onboardingOverlayTop,
} from "@/lib/onboardingSplash";
import {
  onboardingSteps,
  useOnboardingStore,
  type OnboardingStepId,
} from "@/store/useOnboardingStore";
import { describeSourceError } from "@/lib/files/sourceAccess";
import { cubicBezierEasing } from "@/lib/ui/motion";
import { useSourcesStore } from "@/store/useSourcesStore";
import { Button } from "@/components/common/Button/Button";
import { FadingScroller } from "./FadingScroller";
import { TransportPreview } from "./TransportPreview";
import { FoldersStep } from "./steps/FoldersStep";
import { LibraryStep } from "./steps/LibraryStep";
import { PrivacyStep } from "./steps/PrivacyStep";
import { StyleStep } from "./steps/StyleStep";
import { SupportActions, SupportMessage } from "./steps/SupportStep";

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
/** How long Finish stays disabled on the closing support step. */
export const ONBOARDING_FINISH_COUNTDOWN_S = 15;
/** Matches the `.onboarding` opacity transition. */
export const ONBOARDING_FADE_MS = 600;

// Same curve as the `onboarding-panel-in` CSS animation. Evaluated by hand
// (see the dock effect below) instead of handed to `Element.animate()`.
const dockEase = cubicBezierEasing(0.22, 1, 0.36, 1);

/**
 * `split`: text left, controls right, on the same fixed grid for every such
 * step. `centered`: one stacked, centred column, with the description as a
 * note under the controls (read after the choices, it answers "what if I'm
 * not sure?").
 */
const STEPS: Record<
  OnboardingStepId,
  {
    Content: ComponentType;
    layout: "split" | "centered";
    /** Replaces the one-line description with a longer message. */
    Message?: ComponentType;
  }
> = {
  library: { Content: LibraryStep, layout: "centered" },
  folders: { Content: FoldersStep, layout: "split" },
  style: { Content: StyleStep, layout: "split" },
  privacy: { Content: PrivacyStep, layout: "split" },
  support: {
    Content: SupportActions,
    Message: SupportMessage,
    layout: "split",
  },
};

const LAYOUT_CLASSES = {
  split: "onboarding__panel--split",
  centered: "onboarding__panel--centered",
} as const;

/**
 * First-run overlay over the library: plays the Spiral logo reveal once, docks
 * the lockup into the corner, then walks through the welcome steps. Shown on
 * first launch, or again after Developer → Reset welcome screen.
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
  const musicChoice = useOnboardingStore((s) => s.musicChoice);
  const applyMusicChoice = useOnboardingStore((s) => s.applyMusicChoice);
  const settleFolders = useOnboardingStore((s) => s.settleFolders);
  // The folders step needs a folder of the user's own before it moves on.
  const placeholderSourceId = useOnboardingStore((s) => s.placeholderSourceId);
  const hasOwnFolder = useSourcesStore((s) =>
    s.sources.some((source) => source.id !== placeholderSourceId),
  );
  const [advancing, setAdvancing] = useState(false);
  const [stepError, setStepError] = useState<string | null>(null);
  const logoRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<SpiralMotionController | null>(null);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const introRectRef = useRef<DOMRect | null>(null);
  const [docked, setDocked] = useState(false);
  const [leaving, setLeaving] = useState(false);
  // The first panel waits for the logo to dock; later steps appear right away.
  const [navigated, setNavigated] = useState(false);
  // Counts down only while the support step is showing, and starts over
  // whenever the user goes back from it.
  const [finishRemaining, setFinishRemaining] = useState(
    ONBOARDING_FINISH_COUNTDOWN_S,
  );

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
  // Driven by hand frame-by-frame (not `Element.animate()`/a CSS transition)
  // because WebKit's TextureMapper compositor — WebKitGTK/WPE, i.e. Linux —
  // has shipped versions that play a declarative cubic-bezier animation on
  // an accelerated `transform` back linearly instead of eased.
  useLayoutEffect(() => {
    if (!docked) return;
    const el = logoRef.current;
    const first = introRectRef.current;
    if (!el || !first) return;
    const last = el.getBoundingClientRect();
    if (last.width === 0) return;
    const reduced = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduced) return;
    const dx = first.left - last.left;
    const dy = first.top - last.top;
    const fromScale = first.width / last.width;
    el.style.transformOrigin = "top left";
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ONBOARDING_DOCK_MS);
      if (t >= 1) {
        el.style.transform = "";
        el.style.transformOrigin = "";
        return;
      }
      const eased = dockEase(t);
      const scale = fromScale + (1 - fromScale) * eased;
      el.style.transform = `translate(${dx * (1 - eased)}px, ${dy * (1 - eased)}px) scale(${scale})`;
      frame = requestAnimationFrame(tick);
    };
    let frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      el.style.transform = "";
      el.style.transformOrigin = "";
    };
  }, [docked]);

  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(finish, ONBOARDING_FADE_MS);
    return () => clearTimeout(timer);
  }, [leaving, finish]);

  const stepIds = onboardingSteps(musicChoice);
  const isLast = step === stepIds.length - 1;
  const id = stepIds[step];
  const countingDown = docked && id === "support" && finishRemaining > 0;

  useEffect(() => {
    if (!countingDown) return;
    const timer = setTimeout(() => setFinishRemaining((n) => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [countingDown, finishRemaining]);
  const { Content, layout, Message } = STEPS[id];
  const description = Message ? (
    <Message />
  ) : (
    <p className="onboarding__description">
      {t(`onboarding.${id}.description`)}
    </p>
  );
  const goNext = async () => {
    if (advancing) return;
    if (id === "library" || id === "folders") {
      setAdvancing(true);
      setStepError(null);
      try {
        await (id === "library" ? applyMusicChoice() : settleFolders());
      } catch (err) {
        setStepError(describeSourceError(err));
        return;
      } finally {
        setAdvancing(false);
      }
    }
    setNavigated(true);
    next();
  };

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
          <div
            className={`onboarding__panel ${LAYOUT_CLASSES[layout]}${Message ? " onboarding__panel--message" : ""}${navigated ? "" : " onboarding__panel--first"}`}
            key={id}
          >
            <div className="onboarding__intro">
              <h1 className="onboarding__title">
                {t(`onboarding.${id}.title`)}
              </h1>
              {layout === "centered" ? null : description}
              {id === "style" ? <TransportPreview /> : null}
            </div>
            <FadingScroller className="onboarding__content">
              <Content />
            </FadingScroller>
            {layout === "centered" ? description : null}
            {stepError && (id === "library" || id === "folders") ? (
              <p className="onboarding__error" role="alert">
                {stepError}
              </p>
            ) : null}
          </div>
          <footer className="onboarding__footer">
            <span className="onboarding__progress">
              {t("onboarding.progress", {
                current: step + 1,
                total: stepIds.length,
              })}
            </span>
            <div className="onboarding__nav">
              {step > 0 ? (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setNavigated(true);
                    setFinishRemaining(ONBOARDING_FINISH_COUNTDOWN_S);
                    back();
                  }}
                >
                  {t("onboarding.back")}
                </Button>
              ) : null}
              <Button
                variant="primary"
                className={isLast ? "onboarding__finish" : undefined}
                // The first step needs an answer, and the folders step a
                // folder, before either can move on.
                disabled={
                  (id === "library" && musicChoice == null) ||
                  (id === "folders" && !hasOwnFolder) ||
                  (isLast && finishRemaining > 0)
                }
                isLoading={advancing}
                onClick={isLast ? () => setLeaving(true) : () => void goNext()}
              >
                {isLast
                  ? finishRemaining > 0
                    ? t("onboarding.finishIn", { seconds: finishRemaining })
                    : t("onboarding.finish")
                  : t("onboarding.next")}
              </Button>
            </div>
          </footer>
        </>
      ) : null}
    </div>
  );
}
