import { render, screen } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it } from "vitest";
import { BROWSE_GRID_VIRTUALIZE_AFTER } from "../../lib/browseGridLayout";
import { BrowseGridBody } from "./BrowseGridBody";
import { BrowseVirtualGrid } from "./BrowseVirtualGrid";

function GridHarness({ items }: { items: string[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  return (
    <BrowseGridBody bodyRef={scrollRef}>
      <BrowseVirtualGrid
        items={items}
        getItemKey={(item) => item}
        renderItem={(item) => <div>{item}</div>}
        scrollRef={scrollRef}
      />
    </BrowseGridBody>
  );
}

describe("BrowseVirtualGrid", () => {
  it("renders every item below the virtualization threshold", () => {
    render(<GridHarness items={["Alpha", "Beta", "Gamma"]} />);

    expect(screen.getByRole("list")).not.toHaveClass("browse-grid--virtual");
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.getByText("Gamma")).toBeInTheDocument();
  });

  it("stays on the native grid at the threshold", () => {
    const items = Array.from(
      { length: BROWSE_GRID_VIRTUALIZE_AFTER },
      (_, i) => `Item ${i}`,
    );
    render(<GridHarness items={items} />);

    expect(screen.getByRole("list")).not.toHaveClass("browse-grid--virtual");
    expect(screen.getByText("Item 0")).toBeInTheDocument();
    expect(
      screen.getByText(`Item ${BROWSE_GRID_VIRTUALIZE_AFTER - 1}`),
    ).toBeInTheDocument();
  });

  it("uses a virtual grid once the item count crosses the threshold", () => {
    const items = Array.from(
      { length: BROWSE_GRID_VIRTUALIZE_AFTER + 1 },
      (_, i) => `Item ${i}`,
    );
    render(<GridHarness items={items} />);

    expect(screen.getByRole("list")).toHaveClass("browse-grid--virtual");
  });
});
