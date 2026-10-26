import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import "./setup.unit";

// happy-dom rejects `Animation.finished` on cancel() (as browsers do), but unlike
// browsers it leaves the rejection unhandled, so unmounting a framer-motion
// component mid-animation fails the run. Mark the promise handled before cancelling.
const animationPrototype = window.Animation?.prototype;
if (animationPrototype) {
  const cancel = animationPrototype.cancel;
  animationPrototype.cancel = function cancelHandled(this: Animation) {
    this.finished.catch(() => {});
    cancel.call(this);
  };
}

afterEach(() => {
  cleanup();
});
