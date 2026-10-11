import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode, Ref } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetModalStack } from "../../lib/modalStack";
import { usePlayerStore } from "../../store/usePlayerStore";
import type { Track } from "../../types/track";
import { SET_LIST_VIRTUALIZE_AFTER, SetListModal } from "./SetListModal";

vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => children,
  motion: {
    div: ({
      children,
      ref,
      className,
      role,
      "aria-modal": ariaModal,
      "aria-labelledby": ariaLabelledBy,
    }: {
      children?: ReactNode;
      ref?: Ref<HTMLDivElement>;
      className?: string;
      role?: string;
      "aria-modal"?: boolean;
      "aria-labelledby"?: string;
    }) => (
      <div
        ref={ref}
        className={className}
        role={role}
        aria-modal={ariaModal}
        aria-labelledby={ariaLabelledBy}
      >
        {children}
      </div>
    ),
  },
}));

vi.mock("../EntityArt/useEntityArtSrc", () => ({
  useEntityArtSrc: (path: string | null) => (path ? "asset://thumb" : null),
}));

vi.mock("../../lib/rowArtThumb", () => ({
  queueRowArtThumbPrefetch: vi.fn(),
  cancelRowArtThumbPrefetch: vi.fn(),
}));

function track(overrides: Partial<Track> & Pick<Track, "id">): Track {
  return {
    title: `Song ${overrides.id}`,
    artist: "Artist",
    album: "Album",
    albumArtist: "Artist",
    trackNumber: overrides.id,
    totalTracks: null,
    discNumber: 1,
    totalDiscs: null,
    year: null,
    genre: null,
    durationSeconds: 180,
    sampleRate: null,
    bitrate: null,
    codec: null,
    filePath: `/library/${overrides.id}.mp3`,
    artPath: `/library/art/${overrides.id}.jpg`,
    dateAdded: "2024-01-01",
    playCount: 0,
    lastPlayedAt: null,
    rating: 0,
    ...overrides,
  };
}

function seedLibrary(count: number) {
  const library = Array.from({ length: count }, (_, i) => track({ id: i + 1 }));
  usePlayerStore.setState({
    library,
    playbackTracks: library,
    playContextIds: library.map((item) => item.id),
    currentTrackId: library[0]?.id ?? null,
    manualQueueIds: [],
  });
  return library;
}

function mockSetListScrollMetrics() {
  const offsetHeight = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "offsetHeight",
  );
  const offsetWidth = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "offsetWidth",
  );

  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get() {
      if (this.classList.contains("set-list-modal__scroller")) return 320;
      return offsetHeight?.get?.call(this) ?? 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get() {
      if (this.classList.contains("set-list-modal__scroller")) return 432;
      return offsetWidth?.get?.call(this) ?? 0;
    },
  });

  return () => {
    if (offsetHeight) {
      Object.defineProperty(
        HTMLElement.prototype,
        "offsetHeight",
        offsetHeight,
      );
    }
    if (offsetWidth) {
      Object.defineProperty(HTMLElement.prototype, "offsetWidth", offsetWidth);
    }
  };
}

afterEach(() => {
  resetModalStack();
  usePlayerStore.setState({
    library: [],
    playbackTracks: [],
    playContextIds: [],
    currentTrackId: null,
    manualQueueIds: [],
  });
});

describe("SetListModal", () => {
  it("does not mount rows while closed", () => {
    seedLibrary(8);
    render(<SetListModal open={false} onClose={() => undefined} />);

    expect(screen.queryByText("Song 1")).not.toBeInTheDocument();
    expect(screen.queryByText("Song 2")).not.toBeInTheDocument();
  });

  it("uses now playing and up next when nothing is queued", () => {
    seedLibrary(3);
    render(<SetListModal open onClose={() => undefined} />);

    expect(
      screen.getByRole("heading", { name: "Now playing" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Up next" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Queued" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Later" }),
    ).not.toBeInTheDocument();
  });

  it("splits queued tracks into their own section", () => {
    seedLibrary(3);
    usePlayerStore.setState({ manualQueueIds: [2] });
    render(<SetListModal open onClose={() => undefined} />);

    expect(screen.getByRole("heading", { name: "Queued" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Later" })).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Up next" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove from set list" }),
    ).toBeInTheDocument();
    expect(
      document.querySelectorAll(".set-list-modal__row-action"),
    ).toHaveLength(3);
  });

  it("renders every upcoming track below the virtualization threshold", () => {
    seedLibrary(SET_LIST_VIRTUALIZE_AFTER);
    render(<SetListModal open onClose={() => undefined} />);

    expect(screen.getByText("Song 1")).toBeInTheDocument();
    expect(
      screen.getByText(`Song ${SET_LIST_VIRTUALIZE_AFTER}`),
    ).toBeInTheDocument();
    expect(document.querySelector(".set-list-modal__list--virtual")).toBeNull();
  });

  it("virtualizes up next once the list crosses the threshold", async () => {
    const restoreMetrics = mockSetListScrollMetrics();
    const count = SET_LIST_VIRTUALIZE_AFTER + 2;
    seedLibrary(count);
    try {
      render(<SetListModal open onClose={() => undefined} />);

      expect(
        document.querySelector(".set-list-modal__list--virtual"),
      ).not.toBeNull();
      expect(screen.getByText("Song 1")).toBeInTheDocument();
      await waitFor(() => {
        expect(screen.getByText("Song 2")).toBeInTheDocument();
      });
      expect(screen.queryByText(`Song ${count}`)).not.toBeInTheDocument();
    } finally {
      restoreMetrics();
    }
  });
});
