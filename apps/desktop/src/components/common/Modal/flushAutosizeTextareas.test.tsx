import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { flushAutosizeTextareas } from "./useFitModalHeight";

describe("flushAutosizeTextareas", () => {
  it("grows a laid-out autosize textarea to its content height", () => {
    const view = render(
      <textarea
        className="textarea textarea--autosize"
        rows={6}
        defaultValue="line"
      />,
    );
    const el = view.container.querySelector("textarea") as HTMLTextAreaElement;
    vi.spyOn(el, "getClientRects").mockReturnValue([
      {} as DOMRect,
    ] as unknown as DOMRectList);
    Object.defineProperty(el, "scrollHeight", {
      configurable: true,
      get: () => 480,
    });

    flushAutosizeTextareas(view.container);

    expect(el.style.height).toBe("480px");
  });

  it("leaves a textarea with no box alone", () => {
    const view = render(
      <textarea
        className="textarea textarea--autosize"
        rows={6}
        defaultValue="line"
      />,
    );
    const el = view.container.querySelector("textarea") as HTMLTextAreaElement;
    vi.spyOn(el, "getClientRects").mockReturnValue(
      [] as unknown as DOMRectList,
    );

    flushAutosizeTextareas(view.container);

    expect(el.style.height).toBe("");
  });
});
