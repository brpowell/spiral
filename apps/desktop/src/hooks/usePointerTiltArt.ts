import {
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
  type MotionStyle,
} from "framer-motion";
import { useCallback } from "react";
import "./usePointerTiltArt.css";

const DEFAULT_TILT_DEGREES = 9;

const raiseTransition = {
  type: "spring" as const,
  stiffness: 400,
  damping: 25,
};

/** Pointer-driven 3D tilt + tracking glare for browse-grid art. */
export function usePointerTiltArt(tiltDegrees = DEFAULT_TILT_DEGREES) {
  const reduceMotion = useReducedMotion();

  const pointerX = useMotionValue(0.5);
  const pointerY = useMotionValue(0.5);
  const springConfig = { stiffness: 300, damping: 20, mass: 0.5 };
  const rotateX = useSpring(
    useTransform(pointerY, [0, 1], [tiltDegrees, -tiltDegrees]),
    springConfig,
  );
  const rotateY = useSpring(
    useTransform(pointerX, [0, 1], [-tiltDegrees, tiltDegrees]),
    springConfig,
  );
  const glareX = useTransform(pointerX, [0, 1], ["18%", "82%"]);
  const glareY = useTransform(pointerY, [0, 1], ["12%", "78%"]);

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (reduceMotion) return;
      const rect = e.currentTarget.getBoundingClientRect();
      pointerX.set((e.clientX - rect.left) / rect.width);
      pointerY.set((e.clientY - rect.top) / rect.height);
    },
    [pointerX, pointerY, reduceMotion],
  );

  const onPointerLeave = useCallback(() => {
    pointerX.set(0.5);
    pointerY.set(0.5);
  }, [pointerX, pointerY]);

  const style: MotionStyle | undefined = reduceMotion
    ? undefined
    : {
        rotateX,
        rotateY,
        ["--glare-x" as string]: glareX,
        ["--glare-y" as string]: glareY,
      };

  return {
    className: "pointer-tilt-art",
    onPointerMove,
    onPointerLeave,
    style,
    whileHover: reduceMotion ? undefined : { scale: 1.03, y: -4 },
    transition: raiseTransition,
  };
}
