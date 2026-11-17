import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode, Ref } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCdStore } from "@/store/useCdStore";
import { usePlayerStore } from "@/store/usePlayerStore";
import type { Track } from "@/types/track";
import { CdAlbumEditor } from "./CdAlbumEditor";

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

const track = (id: number, genre: string, artist: string) =>
  ({ id, title: `t${id}`, genre, artist, filePath: `/m/${id}.mp3` }) as Track;

describe("CdAlbumEditor", () => {
  beforeEach(() => {
    usePlayerStore.setState({
      library: [track(1, "Metal", "Sepultura"), track(2, "Pop", "Madonna")],
    });
    useCdStore.setState({
      discsByDriveId: {
        d1: { driveId: "d1", discId: "abc", album: "A", tracks: [] },
      },
      editingCdAlbumDriveId: "d1",
    });
  });

  it("suggests library genres and artists while typing", () => {
    render(<CdAlbumEditor />);

    const [artistField, genreField] = screen.getAllByRole("combobox");

    act(() => genreField.focus());
    fireEvent.change(genreField, {
      target: { value: "Me" },
    });
    expect(screen.getByRole("option", { name: "Metal" })).toBeTruthy();

    act(() => artistField.focus());
    fireEvent.change(artistField, {
      target: { value: "Mad" },
    });
    expect(screen.getByRole("option", { name: "Madonna" })).toBeTruthy();
  });
});
