import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode, Ref } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  MusicBrainzEntityHit,
  MusicBrainzEntityLookup,
} from "../../types/musicbrainz";
import { resetModalStack } from "../../lib/modalStack";
import { MusicBrainzEditorTab } from "./MusicBrainzEditorTab";

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

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

const searchMusicBrainzEntities = vi.fn();
const fetchMusicBrainzEntity = vi.fn();
const getMusicBrainzEntity = vi.fn();
const peekMusicBrainzEntity = vi.fn();

vi.mock("../../lib/tauri", () => ({
  searchMusicBrainzEntities: (...args: unknown[]) =>
    searchMusicBrainzEntities(...args),
  fetchMusicBrainzEntity: (...args: unknown[]) =>
    fetchMusicBrainzEntity(...args),
  getMusicBrainzEntity: (...args: unknown[]) => getMusicBrainzEntity(...args),
  peekMusicBrainzEntity: (...args: unknown[]) => peekMusicBrainzEntity(...args),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function hit(title: string, mbid: string): MusicBrainzEntityHit {
  return {
    kind: "release",
    mbid,
    title,
    artist: "Artist",
    year: 1999,
    country: "US",
    trackCount: 10,
  };
}

function lookupFor(title: string, mbid: string): MusicBrainzEntityLookup {
  return { hit: hit(title, mbid), tracklist: [] };
}

beforeEach(() => {
  resetModalStack();
  searchMusicBrainzEntities.mockReset();
  fetchMusicBrainzEntity.mockReset();
  getMusicBrainzEntity.mockReset();
  peekMusicBrainzEntity.mockReset();
  peekMusicBrainzEntity.mockReturnValue(undefined);
  getMusicBrainzEntity.mockResolvedValue(null);
});

describe("MusicBrainzEditorTab search races", () => {
  it("ignores a late search response after the album query changes", async () => {
    const first = deferred<MusicBrainzEntityHit[]>();
    const second = deferred<MusicBrainzEntityHit[]>();
    searchMusicBrainzEntities.mockImplementation(
      (_kind: string, query: string) => {
        if (query === "Album A") return first.promise;
        if (query === "Album B") return second.promise;
        return Promise.resolve([]);
      },
    );

    const { rerender } = render(
      <MusicBrainzEditorTab
        kind="release"
        mbid=""
        searchQuery="Album A"
        searchArtist="Artist A"
        onMbidChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Search for release" }));

    rerender(
      <MusicBrainzEditorTab
        kind="release"
        mbid=""
        searchQuery="Album B"
        searchArtist="Artist B"
        onMbidChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Search for release" }));

    first.resolve([hit("Album A", "11111111-1111-1111-1111-111111111111")]);
    await Promise.resolve();

    expect(screen.queryByRole("button", { name: /Album A/ })).toBeNull();

    second.resolve([hit("Album B", "22222222-2222-2222-2222-222222222222")]);

    expect(
      await screen.findByRole("button", { name: /Album B/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Album A/ })).toBeNull();
  });

  it("does not assign a selected release after the tab unmounts", async () => {
    const search = deferred<MusicBrainzEntityHit[]>();
    const fetch = deferred<MusicBrainzEntityLookup | null>();
    searchMusicBrainzEntities.mockReturnValue(search.promise);
    fetchMusicBrainzEntity.mockReturnValue(fetch.promise);
    const onMbidChange = vi.fn();
    const onEntityLookup = vi.fn();
    const mbid = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

    const { unmount } = render(
      <MusicBrainzEditorTab
        kind="release"
        mbid=""
        searchQuery="Album A"
        searchArtist="Artist A"
        onMbidChange={onMbidChange}
        onEntityLookup={onEntityLookup}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Search for release" }));
    search.resolve([hit("Album A", mbid)]);
    fireEvent.click(await screen.findByRole("button", { name: /Album A/ }));

    unmount();
    fetch.resolve(lookupFor("Album A", mbid));
    await waitFor(() => {
      expect(fetchMusicBrainzEntity).toHaveBeenCalled();
    });

    expect(onMbidChange).not.toHaveBeenCalled();
    expect(onEntityLookup).not.toHaveBeenCalled();
  });
});
