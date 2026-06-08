import { describe, expect, it } from "vitest";
import { shouldDismissModalOnBackdropRelease } from "./modalBackdropDismiss";

describe("shouldDismissModalOnBackdropRelease", () => {
  it.each([
    { pressed: false, released: true, dismiss: false },
    { pressed: true, released: true, dismiss: true },
    { pressed: false, released: false, dismiss: false },
    { pressed: true, released: false, dismiss: false },
  ])(
    "pressed=$pressed released=$released => dismiss=$dismiss",
    ({ pressed, released, dismiss }) => {
      expect(
        shouldDismissModalOnBackdropRelease(pressed, released),
      ).toBe(dismiss);
    },
  );
});
