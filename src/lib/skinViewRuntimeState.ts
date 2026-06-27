import { getSkinSlideshowStateApi } from "./skinSlideshowContext";
import { getSkinViewStateApi } from "./skinViewStateContext";

/** Restore ephemeral in-view state (menu screen, slideshow deck/page) to manifest defaults. */
export function resetSkinViewRuntimeState(): void {
  getSkinViewStateApi()?.reset();
  getSkinSlideshowStateApi()?.reset();
}
