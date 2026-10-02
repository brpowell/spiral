import { fireEvent, render, screen } from "@testing-library/react";
import { useState, type ReactNode, type Ref } from "react";
import { describe, expect, it, vi } from "vitest";
import { PlaylistIconPicker } from "./PlaylistIconPicker";

vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => children,
  motion: {
    div: ({
      children,
      ref,
      initial: _initial,
      animate: _animate,
      exit: _exit,
      transition: _transition,
      ...props
    }: {
      children?: ReactNode;
      ref?: Ref<HTMLDivElement>;
      initial?: unknown;
      animate?: unknown;
      exit?: unknown;
      transition?: unknown;
    } & React.HTMLAttributes<HTMLDivElement>) => (
      <div ref={ref} {...props}>
        {children}
      </div>
    ),
  },
}));

function Harness() {
  const [icon, setIcon] = useState("note");
  return (
    <div>
      <PlaylistIconPicker value={icon} onChange={setIcon} />
      <output>{icon}</output>
    </div>
  );
}

describe("PlaylistIconPicker", () => {
  it("filters the icon grid and selects a match", () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: "Icon: Note" }));

    const search = screen.getByRole("searchbox", { name: "Search icons" });
    expect(search).toHaveFocus();
    expect(screen.getByRole("option", { name: "Heart" })).toBeInTheDocument();

    fireEvent.change(search, { target: { value: "heart" } });

    expect(screen.getByRole("option", { name: "Heart" })).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "Note" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("option", { name: "Heart" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("heart");
    expect(screen.getByRole("button", { name: "Icon: Heart" })).toHaveFocus();
  });

  it("shows an empty message when nothing matches", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Icon: Note" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search icons" }), {
      target: { value: "zzzz-not-an-icon" },
    });

    expect(screen.getByText("No matching icons")).toBeInTheDocument();
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
  });
});
