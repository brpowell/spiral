/**
 * Shared motion for in-place view swaps (library routes, appearance panels).
 * Mirrors the onboarding panels, but as a direct handoff: pair with
 * `AnimatePresence mode="popLayout"` so the outgoing view fades out while the
 * incoming one fades in and eases up 12px, both on the same curve and clock.
 */
const VIEW_SWAP = { duration: 0.2, ease: [0.22, 1, 0.36, 1] as const };

/**
 * Evaluates a CSS `cubic-bezier(x1, y1, x2, y2)` curve at time fraction `t`
 * (0–1) via Newton-Raphson, falling back to a few bisection steps if the
 * slope flattens out. Use this to drive a transform by hand (one frame at a
 * time, writing `style.transform` directly) instead of handing the curve to
 * `Element.animate()` or a CSS transition: WebKit's TextureMapper compositor
 * (WebKitGTK/WPE, i.e. Linux) has shipped versions that play a declarative
 * cubic-bezier animation on an accelerated `transform` back linearly, so
 * this curve only renders correctly everywhere when nothing but our own
 * per-frame math decides the eased value.
 */
export function cubicBezierEasing(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
) {
  const a = (p1: number, p2: number) => 1 - 3 * p2 + 3 * p1;
  const b = (p1: number, p2: number) => 3 * p2 - 6 * p1;
  const c = (p1: number) => 3 * p1;
  const bezier = (t: number, p1: number, p2: number) =>
    ((a(p1, p2) * t + b(p1, p2)) * t + c(p1)) * t;
  const slope = (t: number, p1: number, p2: number) =>
    3 * a(p1, p2) * t * t + 2 * b(p1, p2) * t + c(p1);

  return (t: number): number => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;

    let x = t;
    for (let i = 0; i < 8; i++) {
      const currentSlope = slope(x, x1, x2);
      if (Math.abs(currentSlope) < 1e-6) break;
      x -= (bezier(x, x1, x2) - t) / currentSlope;
    }
    return bezier(x, y1, y2);
  };
}

export const viewTransition = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0, transition: VIEW_SWAP },
  exit: { opacity: 0, transition: VIEW_SWAP },
};

/** Shared enter/exit motion for floating panels (modals, toasts, task pills). */
export const panelMotion = {
  initial: { opacity: 0, scale: 0.98, y: 8 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.98, y: 6 },
  transition: { duration: 0.16, ease: [0.16, 1, 0.3, 1] as const },
};

export const backdropMotion = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.14 },
};

/** Wait this long after closing a modal before starting heavy follow-up work. */
export const MODAL_EXIT_MS = Math.ceil(
  Math.max(
    panelMotion.transition.duration,
    backdropMotion.transition.duration,
  ) * 1000,
);

/** Delayed fade for lightbox companions after shared-layout album art zoom. */
const lightboxCompanionMotion = {
  initial: { opacity: 0, y: 8 },
  animate: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.22,
      delay: 0.14,
      ease: [0.16, 1, 0.3, 1] as const,
    },
  },
  exit: {
    opacity: 0,
    y: 6,
    transition: { duration: 0.18, ease: [0.16, 1, 0.3, 1] as const },
  },
};

export function lightboxCompanionMotionProps(reduceMotion: boolean) {
  if (reduceMotion) {
    return { initial: false as const };
  }

  return {
    initial: lightboxCompanionMotion.initial,
    animate: lightboxCompanionMotion.animate,
    exit: lightboxCompanionMotion.exit,
  };
}

export type LightboxCompanionMotionProps = ReturnType<
  typeof lightboxCompanionMotionProps
>;
