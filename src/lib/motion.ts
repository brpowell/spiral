/** Shared fade for in-place view swaps (library routes, appearance panels). */
export const viewTransition = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.08 },
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
