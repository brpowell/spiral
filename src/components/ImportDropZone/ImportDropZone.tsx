import { getCurrentWindow } from "@tauri-apps/api/window";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { usePlayerStore } from "../../store/usePlayerStore";
import "./ImportDropZone.css";

export function ImportDropZone() {
  const [active, setActive] = useState(false);
  const importFromPaths = usePlayerStore((s) => s.importFromPaths);
  const importFromPathsRef = useRef(importFromPaths);
  importFromPathsRef.current = importFromPaths;

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    void getCurrentWindow()
      .onDragDropEvent((event) => {
        const payload = event.payload;
        switch (payload.type) {
          case "enter":
          case "over":
            setActive(true);
            break;
          case "leave":
            setActive(false);
            break;
          case "drop":
            setActive(false);
            if (payload.paths.length > 0) {
              importFromPathsRef.current(payload.paths);
            }
            break;
        }
      })
      .then((fn) => {
        if (cancelled) {
          fn();
          return;
        }
        unlisten = fn;
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  return (
    <AnimatePresence>
      {active && (
        <motion.div
          className="import-drop-zone"
          role="status"
          aria-live="polite"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <motion.div
            className="import-drop-zone__panel"
            initial={{ scale: 0.96, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.96, opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          >
            <p className="import-drop-zone__title">Drop to import</p>
            <p className="import-drop-zone__hint">
              Audio files and folders will be added to your library
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
