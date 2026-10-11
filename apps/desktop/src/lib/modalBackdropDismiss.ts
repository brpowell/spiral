/** Whether a pointer target is on the backdrop but outside the modal panel. */
export function releasedOutsidePanel(
  backdrop: Node,
  panel: Node,
  target: Node,
): boolean {
  return backdrop.contains(target) && !panel.contains(target);
}

/** Dismiss only when both press and release occurred outside the panel. */
export function shouldDismissModalOnBackdropRelease(
  pressedOutsidePanel: boolean,
  releasedOutsidePanel: boolean,
): boolean {
  return pressedOutsidePanel && releasedOutsidePanel;
}
