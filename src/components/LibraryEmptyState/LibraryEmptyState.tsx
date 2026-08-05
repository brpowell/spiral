import { useReducedMotion } from "framer-motion";
import {
  useCallback,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { usePlayerStore } from "../../store/usePlayerStore";
import { Button } from "../common/Button/Button";
import { EmptyState } from "../common/EmptyState/EmptyState";
import "./LibraryEmptyState.css";

type PatternVars = CSSProperties & {
  "--mx": string;
  "--my": string;
};

export function LibraryEmptyState() {
  const { t } = useTranslation("library");
  const addToLibrary = usePlayerStore((s) => s.addToLibrary);
  const reduceMotion = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const [lit, setLit] = useState(false);
  const [patternStyle, setPatternStyle] = useState<PatternVars>({
    "--mx": "50%",
    "--my": "50%",
  });

  const onPointerMove = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (reduceMotion) return;
      const el = rootRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      setLit(true);
      setPatternStyle({
        "--mx": `${x * 100}%`,
        "--my": `${y * 100}%`,
      });
    },
    [reduceMotion],
  );

  const onPointerLeave = useCallback(() => {
    setLit(false);
  }, []);

  return (
    <div
      ref={rootRef}
      className={`library-empty-state${lit ? " library-empty-state--lit" : ""}`}
      style={patternStyle}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
    >
      <div className="library-empty-state__pattern" aria-hidden />
      <div className="library-empty-state__discs" aria-hidden>
        <div className="library-empty-state__disc library-empty-state__disc--vinyl">
          <div className="library-empty-state__disc-body" />
          <div className="library-empty-state__disc-glint" />
        </div>
        <div className="library-empty-state__disc library-empty-state__disc--cd">
          <div className="library-empty-state__disc-body" />
          <div className="library-empty-state__disc-glint" />
        </div>
      </div>
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
