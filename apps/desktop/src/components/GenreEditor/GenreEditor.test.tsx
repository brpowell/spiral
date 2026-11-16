import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode, Ref } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePlayerStore } from "@/store/usePlayerStore";
import type { Track } from "@/types/track";
import { GenreEditor } from "./GenreEditor";

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

const track = (id: number, genre: string) =>
  ({ id, title: `t${id}`, genre, filePath: `/m/${id}.mp3` }) as Track;

describe("GenreEditor", () => {
  beforeEach(() => {
    usePlayerStore.setState({
      library: [
        track(1, "Metal"),
        track(2, "Metal"),
        track(3, "Rap Metal"),
        track(4, "Pop"),
      ],
      editingGenreKey: null,
    });
  });

  it("opens with the genre name in the focused field, selected", () => {
    render(<GenreEditor />);
    act(() => usePlayerStore.getState().openGenreEditor("metal"));

    const input = screen.getByRole("combobox") as HTMLInputElement;
    expect(input.value).toBe("Metal");
    expect(input).toHaveFocus();
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe("Metal".length);
  });

  it("does not open the suggestion menu just because the field opened focused", () => {
    render(<GenreEditor />);
    act(() => usePlayerStore.getState().openGenreEditor("metal"));
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("offers other genres once the user types", () => {
    render(<GenreEditor />);
    act(() => usePlayerStore.getState().openGenreEditor("metal"));

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "Rap" },
    });
    expect(screen.getByRole("option", { name: "Rap Metal" })).toBeTruthy();
  });

  it("loads the next genre's name when reopened on another genre", () => {
    render(<GenreEditor />);
    act(() => usePlayerStore.getState().openGenreEditor("metal"));
    act(() => usePlayerStore.getState().closeGenreEditor());
    act(() => usePlayerStore.getState().openGenreEditor("pop"));

    expect((screen.getByRole("combobox") as HTMLInputElement).value).toBe(
      "Pop",
    );
  });
});
