import { invoke } from "@tauri-apps/api/core";

/**
 * Skin windows use their own drag-region attribute rather than
 * `data-tauri-drag-region`. Tauri's built-in handler starts the drag from
 * whatever event AppKit has current when the async request lands, which
 * mis-anchors the window; `start_skin_window_drag` anchors on the live cursor
 * instead. Attribute values mirror Tauri's semantics.
 */
export const SKIN_DRAG_REGION = "data-skin-drag-region";

/** Subtree drag: clicks on non-interactive descendants move the window. */
export function skinDragRegionDeepProps(): Record<string, string> {
  return { [SKIN_DRAG_REGION]: "deep" };
}

/** Opt interactive controls out of a parent drag region. */
export function skinDragRegionNoneProps(): Record<string, string> {
  return { [SKIN_DRAG_REGION]: "false" };
}

const CLICKABLE_TAGS = new Set([
  "A",
  "BUTTON",
  "INPUT",
  "SELECT",
  "TEXTAREA",
  "LABEL",
  "SUMMARY",
]);

const INTERACTIVE_ROLES = new Set([
  "button",
  "link",
  "menuitem",
  "tab",
  "checkbox",
  "radio",
  "switch",
  "option",
]);

function isClickableElement(el: HTMLElement): boolean {
  return (
    CLICKABLE_TAGS.has(el.tagName) ||
    (el.hasAttribute("contenteditable") &&
      el.getAttribute("contenteditable") !== "false") ||
    (el.hasAttribute("tabindex") && el.getAttribute("tabindex") !== "-1") ||
    INTERACTIVE_ROLES.has(el.getAttribute("role") ?? "")
  );
}

/** Walk the composed path outward, resolving the nearest drag-region intent. */
function isSkinDragRegion(composedPath: EventTarget[]): boolean {
  for (const node of composedPath) {
    if (!(node instanceof HTMLElement)) continue;
    const attr = node.getAttribute(SKIN_DRAG_REGION);
    if (isClickableElement(node) && attr === null) return false;
    if (attr === null) continue;
    if (attr === "false") return false;
    if (attr === "deep") return true;
    if (attr === "" || attr === "true") return node === composedPath[0];
  }
  return false;
}

/** Route mousedowns on skin drag regions to the native window drag. */
export function startSkinDragRegions(): () => void {
  const onMouseDown = (event: MouseEvent) => {
    if (event.button !== 0) return;
    if (!isSkinDragRegion(event.composedPath())) return;
    event.preventDefault();
    void invoke("start_skin_window_drag").catch(() => {});
  };

  document.addEventListener("mousedown", onMouseDown);
  return () => document.removeEventListener("mousedown", onMouseDown);
}
