import { useRef } from "react";
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
  const lastNonNull = useRef("Back");
  if (ctx != null) {
    lastNonNull.current = detailReturnLabel(ctx, artists);
  }
  return lastNonNull.current;
}
