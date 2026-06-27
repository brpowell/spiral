/** Tauri v2 drag-region attribute values (see tauri window drag docs). */
export const SKIN_TAURI_DRAG_REGION = "data-tauri-drag-region";

/** Subtree drag: clicks on non-interactive descendants move the window. */
export function skinDragRegionDeepProps(): Record<string, string> {
  return { [SKIN_TAURI_DRAG_REGION]: "deep" };
}

/** Opt interactive controls out of a parent drag region. */
export function skinDragRegionNoneProps(): Record<string, string> {
  return { [SKIN_TAURI_DRAG_REGION]: "false" };
}
