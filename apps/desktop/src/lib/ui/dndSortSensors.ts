import { PointerActivationConstraints } from "@dnd-kit/dom";
import { KeyboardSensor, PointerSensor } from "@dnd-kit/react";

/** Space starts/ends keyboard reorder; Enter left free for activate/play. */
export const SORT_KEYBOARD_SENSOR = KeyboardSensor.configure({
  keyboardCodes: {
    start: ["Space"],
    cancel: ["Escape"],
    end: ["Space", "Enter", "Tab"],
    up: ["ArrowUp"],
    down: ["ArrowDown"],
    left: ["ArrowLeft"],
    right: ["ArrowRight"],
  },
});

/** Pointer on a dedicated handle (e.g. grip button). */
export const HANDLE_POINTER_SENSOR = PointerSensor.configure({
  preventActivation: () => false,
});

/**
 * Whole clickable item is the handle. dnd-kit's default for mouse-on-handle
 * activates immediately and steals clicks — require a short drag instead.
 */
export const CLICKABLE_ITEM_POINTER_SENSOR = PointerSensor.configure({
  preventActivation: () => false,
  activationConstraints: (event) => {
    if (event.pointerType === "touch") {
      return [
        new PointerActivationConstraints.Delay({ value: 250, tolerance: 5 }),
      ];
    }
    return [new PointerActivationConstraints.Distance({ value: 8 })];
  },
});
