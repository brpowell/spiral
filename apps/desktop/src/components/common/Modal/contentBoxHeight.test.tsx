import { describe, expect, it } from "vitest";
import { contentBoxHeight } from "./fitModalHeight";

describe("contentBoxHeight", () => {
  function box(height: number): HTMLElement {
    const el = document.createElement("div");
    Object.defineProperty(el, "offsetHeight", { value: height });
    return el;
  }

  function panel(...children: HTMLElement[]): HTMLElement {
    const el = document.createElement("div");
    el.style.rowGap = "10px";
    el.style.paddingBottom = "8px";
    el.append(...children);
    document.body.append(el);
    return el;
  }

  it("sums children, gaps and padding", () => {
    expect(contentBoxHeight(panel(box(100), box(50)))).toBe(168);
  });

  it("measures through display: contents wrappers, which report no height", () => {
    const wrapper = box(0);
    wrapper.style.display = "contents";
    wrapper.append(box(100), box(50));

    expect(contentBoxHeight(panel(wrapper))).toBe(168);
  });

  it("leaves out children that are not displayed", () => {
    const gone = box(0);
    gone.style.display = "none";

    expect(contentBoxHeight(panel(box(100), gone))).toBe(108);
  });
});
