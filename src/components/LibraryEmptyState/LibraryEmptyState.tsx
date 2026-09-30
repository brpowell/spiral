import { useReducedMotion } from "framer-motion";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { usePlayerStore } from "../../store/usePlayerStore";
import { Button } from "../common/Button/Button";
import { EmptyState } from "../common/EmptyState/EmptyState";
import { mountNotesField } from "./notesField";
import "./LibraryEmptyState.css";

export function LibraryEmptyState() {
  const { t } = useTranslation("library");
  const addToLibrary = usePlayerStore((s) => s.addToLibrary);
  const reduceMotion = useReducedMotion() === true;
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    return mountNotesField(canvas, { reduceMotion });
  }, [reduceMotion]);

  return (
    <div className="library-empty-state">
      <canvas
        ref={canvasRef}
        className="library-empty-state__field"
        aria-hidden
      />
      <EmptyState
        className="library-empty-state__card"
        title={t("empty.title")}
        description={t("empty.description")}
        action={
          <Button variant="primary" onClick={() => void addToLibrary()}>
            {t("empty.addButton")}
          </Button>
        }
      />
    </div>
  );
}
