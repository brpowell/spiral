import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { useResetOnOpen } from "./useResetOnOpen";

function Harness({ open, initial }: { open: boolean; initial: string }) {
  const [tab, setTab] = useState("art");
  useResetOnOpen(open, initial, tab, setTab);
  return (
    <>
      <div data-testid="tab">{tab}</div>
      <button type="button" onClick={() => setTab("lyrics")}>
        switch
      </button>
    </>
  );
}

describe("useResetOnOpen", () => {
  it("applies the opening value before paint", () => {
    const view = render(<Harness open={false} initial="details" />);
    expect(screen.getByTestId("tab").textContent).toBe("art");

    view.rerender(<Harness open initial="details" />);
    expect(screen.getByTestId("tab").textContent).toBe("details");
  });

  it("leaves the current value alone while the panel stays open or closes", () => {
    const view = render(<Harness open={false} initial="details" />);
    view.rerender(<Harness open initial="details" />);
    expect(screen.getByTestId("tab").textContent).toBe("details");

    fireEvent.click(screen.getByRole("button", { name: "switch" }));
    expect(screen.getByTestId("tab").textContent).toBe("lyrics");

    view.rerender(<Harness open initial="details" />);
    expect(screen.getByTestId("tab").textContent).toBe("lyrics");

    view.rerender(<Harness open={false} initial="details" />);
    expect(screen.getByTestId("tab").textContent).toBe("lyrics");
  });

  it("applies a fresh opening value after close", () => {
    const view = render(<Harness open={false} initial="details" />);
    view.rerender(<Harness open initial="details" />);
    fireEvent.click(screen.getByRole("button", { name: "switch" }));
    view.rerender(<Harness open={false} initial="details" />);
    view.rerender(<Harness open initial="art" />);
    expect(screen.getByTestId("tab").textContent).toBe("art");
  });
});
