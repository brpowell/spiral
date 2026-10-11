import { getCurrentWindow } from "@tauri-apps/api/window";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import {
  isExternalFileDrag,
  pathsFromDataTransfer,
} from "../../lib/dragDrop";
import {
  routeDroppedPaths,
} from "../../lib/fileDropRouting";
import { isTauri } from "../../lib/windowRole";
import { usePlayerStore } from "../../store/usePlayerStore";
import "./ImportDropZone.css";

function handleDroppedPaths(
  paths: string[],
  importFromPaths: (paths: string[]) => void,
  position?: { x: number; y: number },
) {
  if (paths.length === 0) return;

  if (routeDroppedPaths(paths, position) === "library") {
    importFromPaths(paths);
  }
}

export function ImportDropZone() {
  const [active, setActive] = useState(false);
  const importFromPaths = usePlayerStore((s) => s.importFromPaths);
  const importFromPathsRef = useRef(importFromPaths);
  importFromPathsRef.current = importFromPaths;
  const dragDepthRef = useRef(0);

  useEffect(() => {
    if (isTauri()) {
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
              handleDroppedPaths(
                payload.paths,
                importFromPathsRef.current,
                payload.position,
              );
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
    }

    const reset = () => {
      dragDepthRef.current = 0;
      setActive(false);
    };

    const onDragEnter = (e: DragEvent) => {
      if (!isExternalFileDrag(e.dataTransfer)) return;
      e.preventDefault();
      dragDepthRef.current += 1;
      setActive(true);
    };

    const onDragOver = (e: DragEvent) => {
      if (!isExternalFileDrag(e.dataTransfer)) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = "copy";
      setActive(true);
    };

    const onDragLeave = (e: DragEvent) => {
      if (!isExternalFileDrag(e.dataTransfer)) return;
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) {
        setActive(false);
      }
    };

    const onDrop = (e: DragEvent) => {
      if (!isExternalFileDrag(e.dataTransfer)) return;
      e.preventDefault();
      const paths = pathsFromDataTransfer(e.dataTransfer);
      reset();
      handleDroppedPaths(paths, importFromPathsRef.current, {
        x: e.clientX,
        y: e.clientY,
      });
    };

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);

    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
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
              Audio files, folders, and zip archives
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
