import { afterEach, describe, expect, it, vi } from "vitest";
import { handleTrackListRowCellKeyDown } from "./trackListRowCellNav";

function control(column: string): HTMLElement {
  const el = document.createElement("span");
  el.tabIndex = -1;
  el.setAttribute("data-track-list-cell-control", "");
  el.setAttribute("data-track-list-cell-column", column);
  el.setAttribute("data-track-list-cell-sub-index", "0");
  return el;
}

function keyEvent(key: string, target: HTMLElement) {
  return {
    key,
    target,
    shiftKey: false,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as React.KeyboardEvent;
}

describe("handleTrackListRowCellKeyDown cell controls", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  function buildRow() {
    const row = document.createElement("li");
    row.tabIndex = 0;
    const rating = control("rating");
    const popularity = control("popularity");
    row.append(rating, popularity);
    document.body.append(row);
    return { row, rating, popularity };
  }

  it("moves from Rating to Popularity with ArrowRight and back with ArrowLeft", () => {
    const { row, rating, popularity } = buildRow();
    rating.focus();

    expect(
      handleTrackListRowCellKeyDown(
        keyEvent("ArrowRight", rating),
        row,
        null,
        vi.fn(),
      ),
    ).toBe(true);
    expect(document.activeElement).toBe(popularity);

    handleTrackListRowCellKeyDown(
      keyEvent("ArrowLeft", popularity),
      row,
      null,
      vi.fn(),
    );
    expect(document.activeElement).toBe(rating);
  });

  it("reports an Up/Down move from Popularity so the next row can focus the same column", () => {
    const { row, popularity } = buildRow();
    const onRowCellNavigation = vi.fn();
    popularity.focus();

    handleTrackListRowCellKeyDown(
      keyEvent("ArrowDown", popularity),
      row,
      null,
      onRowCellNavigation,
    );

    expect(onRowCellNavigation).toHaveBeenCalledWith(expect.anything(), {
      column: "popularity",
      subIndex: 0,
    });
  });

  it("does not treat Enter on Popularity as an action", () => {
    const { row, popularity } = buildRow();
    const click = vi.fn();
    popularity.addEventListener("click", click);
    popularity.focus();

    const handled = handleTrackListRowCellKeyDown(
      keyEvent("Enter", popularity),
      row,
      null,
      vi.fn(),
    );

    expect(handled).toBe(false);
    expect(click).not.toHaveBeenCalled();
  });
});
