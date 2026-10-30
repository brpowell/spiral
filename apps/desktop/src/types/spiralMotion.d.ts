/** Subset of the Spiral design system's motion bundle (`src/vendor/spiral-motion`). */
interface SpiralMotionController {
  replay(): void;
  setSound(on: boolean): void;
  destroy(): void;
  /** Resolves when the reveal lands on the lockup. */
  finished: Promise<void>;
  duration: number;
  element: SVGSVGElement;
}

interface SpiralMotionOptions {
  autoplay?: boolean;
  sound?: boolean;
  loop?: boolean;
  speed?: number;
  reducedMotion?: "auto" | "ignore";
  colors?: { mark?: string; accent?: string };
  label?: string;
  onComplete?: () => void;
}

interface Window {
  Spiral?: {
    LogoReveal: {
      mount(el: Element, options?: SpiralMotionOptions): SpiralMotionController;
    };
  };
}
