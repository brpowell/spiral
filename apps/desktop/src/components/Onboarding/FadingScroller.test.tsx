import { act, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FadingScroller } from "./FadingScroller";

function setMetrics(
  el: HTMLElement,
  m: { scrollTop: number; scrollHeight: number; clientHeight: number },
) {
  for (const [key, value] of Object.entries(m)) {
    Object.defineProperty(el, key, { value, configurable: true });
  }
}

function setup() {
  const { container } = render(
    <FadingScroller className="scroller">
      <p>content</p>
    </FadingScroller>,
  );
  return container.querySelector<HTMLElement>(".scroller")!;
}

describe("FadingScroller", () => {
  it("fades only the bottom edge at the top of overflowing content", () => {
    const el = setup();
    setMetrics(el, { scrollTop: 0, scrollHeight: 600, clientHeight: 300 });
    act(() => {
      el.dispatchEvent(new Event("scroll"));
    });
    expect(el).not.toHaveAttribute("data-fade-top");
    expect(el).toHaveAttribute("data-fade-bottom");
  });

  it("fades both edges in the middle", () => {
    const el = setup();
    setMetrics(el, { scrollTop: 100, scrollHeight: 600, clientHeight: 300 });
    act(() => {
      el.dispatchEvent(new Event("scroll"));
    });
    expect(el).toHaveAttribute("data-fade-top");
    expect(el).toHaveAttribute("data-fade-bottom");
  });

  it("fades only the top edge once scrolled to the end", () => {
    const el = setup();
    setMetrics(el, { scrollTop: 300, scrollHeight: 600, clientHeight: 300 });
    act(() => {
      el.dispatchEvent(new Event("scroll"));
    });
    expect(el).toHaveAttribute("data-fade-top");
    expect(el).not.toHaveAttribute("data-fade-bottom");
  });

  it("does not fade content that fits", () => {
    const el = setup();
    setMetrics(el, { scrollTop: 0, scrollHeight: 300, clientHeight: 300 });
    act(() => {
      el.dispatchEvent(new Event("scroll"));
    });
    expect(el).not.toHaveAttribute("data-fade-top");
    expect(el).not.toHaveAttribute("data-fade-bottom");
  });
});
