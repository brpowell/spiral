import { useRef } from "react";
import { t } from "../lib/i18n";
import {
  detailReturnLabel,
  type DetailReturnContext,
} from "../lib/navigationReturn";
import type { Artist } from "../types/artist";

/**
 * Back-button label that stays put when return context is cleared while the
 * detail view is still exiting (AnimatePresence after sidebar setView).
 */
export function useDetailReturnLabel(
  ctx: DetailReturnContext | null,
  artists: Artist[],
): string {
  const lastNonNull = useRef(t("common:back"));
  if (ctx != null) {
    lastNonNull.current = detailReturnLabel(ctx, artists);
  }
  return lastNonNull.current;
}
