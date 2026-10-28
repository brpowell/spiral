import { render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useFitModalHeight } from "./useFitModalHeight";

/**
 * Like the real thing, observing a target schedules an initial notification
 * for it. A hook that re-observes its targets on every pass keeps itself busy.
 */
class FakeResizeObserver {
  static callbackCount = 0;
  private targets = new Set<Element>();
  private scheduled = false;

  constructor(private readonly callback: ResizeObserverCallback) {}

  observe(target: Element) {
    this.targets.add(target);
    if (this.scheduled) return;
    this.scheduled = true;
    setTimeout(() => {
      this.scheduled = false;
      if (this.targets.size === 0) return;
      FakeResizeObserver.callbackCount += 1;
      this.callback([], this as unknown as ResizeObserver);
    }, 0);
  }

  unobserve(target: Element) {
    this.targets.delete(target);
  }

  disconnect() {
    this.targets.clear();
  }
}

function Harness() {
  const panelRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  useFitModalHeight(true, panelRef, backdropRef);
  return (
    <div ref={backdropRef}>
      <div ref={panelRef}>
        <div className="modal-header">Header</div>
        <div className="modal-body">Body</div>
        <div className="modal-footer">Footer</div>
      </div>
    </div>
  );
}

describe("useFitModalHeight", () => {
  const originalResizeObserver = globalThis.ResizeObserver;

  beforeEach(() => {
    FakeResizeObserver.callbackCount = 0;
    globalThis.ResizeObserver =
      FakeResizeObserver as unknown as typeof ResizeObserver;
  });

  afterEach(() => {
    globalThis.ResizeObserver = originalResizeObserver;
  });

  it("stops measuring once the layout stops changing", async () => {
    render(<Harness />);

    await new Promise((resolve) => setTimeout(resolve, 100));
    const settled = FakeResizeObserver.callbackCount;
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(FakeResizeObserver.callbackCount).toBe(settled);
  });
});
