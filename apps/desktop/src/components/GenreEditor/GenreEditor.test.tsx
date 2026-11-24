import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import type { ReactNode, Ref } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useGenreBackgroundStore } from "@/store/useGenreBackgroundStore";
import { usePlayerStore } from "@/store/usePlayerStore";
import type { Track } from "@/types/track";
import { writeTrackMetadata } from "@/lib/tauri";
import { GenreEditor } from "./GenreEditor";

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  writeTrackMetadata: vi.fn(),
  setGenreBackgrounds: vi.fn().mockResolvedValue(undefined),
  renameGenreSettingsKey: vi.fn().mockResolvedValue(undefined),
}));

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
  ({
    id: String(id),
    title: `t${id}`,
    genre,
    filePath: `/m/${id}.mp3`,
  }) as Track;

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
    useGenreBackgroundStore.setState({ backgrounds: {} });
    vi.mocked(writeTrackMetadata).mockClear();
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

  it("has Details and Art tabs, opening on Details with the name", () => {
    render(<GenreEditor />);
    act(() => usePlayerStore.getState().openGenreEditor("metal"));

    expect(
      screen
        .getByRole("tab", { name: "Details" })
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(screen.getByRole("tab", { name: "Art" })).toBeTruthy();
    expect(screen.getByRole("combobox")).toBeTruthy();
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });

  it("returns to the Details tab when reopened", () => {
    render(<GenreEditor />);
    act(() => usePlayerStore.getState().openGenreEditor("metal"));
    fireEvent.click(screen.getByRole("tab", { name: "Art" }));
    act(() => usePlayerStore.getState().closeGenreEditor());
    act(() => usePlayerStore.getState().openGenreEditor("pop"));

    expect(
      screen
        .getByRole("tab", { name: "Details" })
        .getAttribute("aria-selected"),
    ).toBe("true");
  });

  describe("background", () => {
    // The background lives on the Art tab.
    const open = () => {
      cleanup();
      render(<GenreEditor />);
      act(() => usePlayerStore.getState().openGenreEditor("metal"));
      fireEvent.click(screen.getByRole("tab", { name: "Art" }));
    };
    const save = () => screen.getByRole("button", { name: "Save" });

    it("defaults to the theme palette, with no color selector", () => {
      open();
      expect(
        (
          screen.getByRole("radio", {
            name: "Use theme palette",
          }) as HTMLInputElement
        ).checked,
      ).toBe(true);
      expect(screen.queryByRole("button", { name: "Color" })).toBeNull();
      expect((save() as HTMLButtonElement).disabled).toBe(true);
    });

    it("shows the color selector when choosing a color, and enables Save", () => {
      open();
      fireEvent.click(screen.getByRole("radio", { name: "Choose color" }));

      expect(screen.getByRole("button", { name: "Color" })).toBeTruthy();
      expect((save() as HTMLButtonElement).disabled).toBe(false);
    });

    it("goes back to unchanged when the theme palette is picked again", () => {
      open();
      fireEvent.click(screen.getByRole("radio", { name: "Choose color" }));
      fireEvent.click(screen.getByRole("radio", { name: "Use theme palette" }));

      expect(screen.queryByRole("button", { name: "Color" })).toBeNull();
      expect((save() as HTMLButtonElement).disabled).toBe(true);
    });

    it("offers a gradient toggle for the theme palette, on by default", () => {
      open();
      const toggle = screen.getByRole("switch", {
        name: "Gradient",
      }) as HTMLInputElement;
      expect(toggle.checked).toBe(true);

      fireEvent.click(toggle);
      expect(toggle.checked).toBe(false);
      expect((save() as HTMLButtonElement).disabled).toBe(false);

      fireEvent.click(toggle);
      expect((save() as HTMLButtonElement).disabled).toBe(true);
    });

    it("saves a flat theme palette and reopens with the gradient off", async () => {
      open();
      fireEvent.click(screen.getByRole("switch", { name: "Gradient" }));
      await act(async () => {
        fireEvent.click(save());
      });
      expect(useGenreBackgroundStore.getState().backgrounds.metal).toEqual({
        theme: "solid",
      });

      open();
      expect(
        (screen.getByRole("switch", { name: "Gradient" }) as HTMLInputElement)
          .checked,
      ).toBe(false);
    });

    it("remembers each mode's choices when switching, without dirtying the form", () => {
      open();
      fireEvent.click(screen.getByRole("radio", { name: "Choose color" }));
      // Picking a color starts from the theme gradient; drop its second color.
      fireEvent.click(
        screen.getByRole("button", { name: "Clear second color" }),
      );
      const hasSecond = () =>
        screen.queryByRole("button", { name: "Add second color" }) == null;
      expect(hasSecond()).toBe(false);

      // Back to the theme palette: nothing changed from what was saved.
      fireEvent.click(screen.getByRole("radio", { name: "Use theme palette" }));
      expect((save() as HTMLButtonElement).disabled).toBe(true);

      // Returning restores the choice, and now the form is dirty.
      fireEvent.click(screen.getByRole("radio", { name: "Choose color" }));
      expect(hasSecond()).toBe(false);
      expect((save() as HTMLButtonElement).disabled).toBe(false);
    });

    it("keeps the gradient setting while the color mode is shown", () => {
      open();
      fireEvent.click(screen.getByRole("switch", { name: "Gradient" }));
      fireEvent.click(screen.getByRole("radio", { name: "Choose color" }));
      fireEvent.click(screen.getByRole("radio", { name: "Use theme palette" }));
      expect(
        (screen.getByRole("switch", { name: "Gradient" }) as HTMLInputElement)
          .checked,
      ).toBe(false);
    });

    it("can apply the pending background to every genre", async () => {
      open();
      fireEvent.click(screen.getByRole("radio", { name: "Choose color" }));
      expect((save() as HTMLButtonElement).disabled).toBe(false);
      fireEvent.click(
        screen.getByRole("checkbox", { name: "Apply to all genres" }),
      );
      await act(async () => {
        fireEvent.click(save());
      });

      const { backgrounds } = useGenreBackgroundStore.getState();
      expect(Object.keys(backgrounds).sort()).toEqual([
        "metal",
        "pop",
        "rap metal",
      ]);
      expect(backgrounds.pop).toEqual(backgrounds.metal);
    });

    it("lets applying the unchanged background to all genres be saved", () => {
      open();
      fireEvent.click(
        screen.getByRole("checkbox", { name: "Apply to all genres" }),
      );
      expect((save() as HTMLButtonElement).disabled).toBe(false);
    });

    it("saves a chosen color without rewriting any tags", async () => {
      open();
      fireEvent.click(screen.getByRole("radio", { name: "Choose color" }));
      await act(async () => {
        fireEvent.click(save());
      });

      expect(useGenreBackgroundStore.getState().backgrounds.metal).toBeTruthy();
      expect(writeTrackMetadata).not.toHaveBeenCalled();
      expect(usePlayerStore.getState().editingGenreKey).toBeNull();
    });

    it("opens with a genre's saved color already chosen", () => {
      useGenreBackgroundStore.setState({
        backgrounds: { metal: { start: "#336699", end: null } },
      });
      open();
      expect(
        (
          screen.getByRole("radio", {
            name: "Choose color",
          }) as HTMLInputElement
        ).checked,
      ).toBe(true);
      expect((save() as HTMLButtonElement).disabled).toBe(true);
    });
  });
});
