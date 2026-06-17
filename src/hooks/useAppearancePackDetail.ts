import { useCallback, useState } from "react";

export type AppearancePackKind = "theme" | "visualizer" | "skin";

export type AppearancePackRef = {
  kind: AppearancePackKind;
  id: string;
};

export function useAppearancePackDetail() {
  const [detail, setDetail] = useState<AppearancePackRef | null>(null);

  const openDetail = useCallback((ref: AppearancePackRef) => {
    setDetail(ref);
  }, []);

  const closeDetail = useCallback(() => {
    setDetail(null);
  }, []);

  return { detail, openDetail, closeDetail };
}
