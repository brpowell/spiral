import { AnimatePresence, motion } from "framer-motion";
import type { ReactNode, RefObject } from "react";
import { backdropMotion, panelMotion } from "../../lib/motion";

interface AnimatedModalProps {
  open: boolean;
  backdropClassName: string;
  panelClassName: string;
  panelRef?: RefObject<HTMLDivElement | null>;
  labelledBy?: string;
  onBackdropClick: () => void;
  children: ReactNode;
}

export function AnimatedModal({
  open,
  backdropClassName,
  panelClassName,
  panelRef,
  labelledBy,
  onBackdropClick,
  children,
}: AnimatedModalProps) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className={backdropClassName}
          onClick={onBackdropClick}
          {...backdropMotion}
        >
          <motion.div
            ref={panelRef}
            className={panelClassName}
            role="dialog"
            aria-modal="true"
            aria-labelledby={labelledBy}
            onClick={(e) => e.stopPropagation()}
            {...panelMotion}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
