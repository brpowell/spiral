import { getSkinSlideshowStateApi } from "./skinSlideshowContext";
import { getSkinScrollStripStateApi } from "./skinScrollStripContext";
import { getSkinViewStateApi } from "./skinViewStateContext";

/** Restore ephemeral in-view state (menu screen, slideshow deck/page, scroll strip slide) to manifest defaults. */
export function resetSkinViewRuntimeState(): void {
  getSkinViewStateApi()?.reset();
  getSkinSlideshowStateApi()?.reset();
  getSkinScrollStripStateApi()?.reset();
}
