import { beforeEach, describe, expect, it } from "vitest";
import {
  albumTitleFromKey,
  captureReturnContext,
  detailReturnLabel,
  stateAfterCloseAlbum,
  stateAfterCloseArtist,
  stateAfterClosePlaylist,
} from "./navigationReturn";
import { useCdStore } from "../store/useCdStore";
import { useNavigationStore } from "../store/useNavigationStore";
import type { Artist } from "../types/artist";
import type { Playlist } from "../types/playlist";

function playlist(id: number, title: string): Playlist {
  return {
    id,
    title,
    description: null,
    dateCreated: "2026-01-01",
    lastUsedAt: "2026-01-01",
    trackIds: [],
    imageMode: "generated",
    customImagePath: null,
    coverBackground: null,
    coverBackgroundEnd: null,
    coverIcon: null,
  };
}

const artists: Artist[] = [
  {
    key: "rage",
    name: "Rage Against the Machine",
    artPath: null,
    tracks: [],
  },
];

const ALBUM_KEY = "The Battle of Los Angeles\0Rage Against the Machine";

describe("albumTitleFromKey", () => {
  it("extracts title from album key", () => {
    expect(albumTitleFromKey(ALBUM_KEY)).toBe("The Battle of Los Angeles");
  });
});

describe("captureReturnContext", () => {
  it("captures library sidebar when on track list", () => {
    expect(
      captureReturnContext(
        {
          view: "library",
          albumKey: null,
          artistKey: null,
          playlistId: null,
          cdDriveId: null,
        },
        [],
      ),
    ).toEqual({ kind: "sidebar", view: "library" });
  });

  it("captures artist when opening album from artist detail", () => {
    expect(
      captureReturnContext(
        {
          view: "artists",
          albumKey: null,
          artistKey: "rage",
          playlistId: null,
          cdDriveId: null,
        },
        [],
      ),
    ).toEqual({ kind: "artist", artistKey: "rage" });
  });

  it("captures album when opening artist from album detail", () => {
    expect(
      captureReturnContext(
        {
          view: "library",
          albumKey: ALBUM_KEY,
          artistKey: null,
          playlistId: null,
          cdDriveId: null,
        },
        [],
      ),
    ).toEqual({
      kind: "album",
      albumKey: ALBUM_KEY,
      title: "The Battle of Los Angeles",
    });
  });

  it("prefers album over sidebar when album is open", () => {
    expect(
      captureReturnContext(
        {
          view: "albums",
          albumKey: ALBUM_KEY,
          artistKey: null,
          playlistId: null,
          cdDriveId: null,
        },
        [],
      ).kind,
    ).toBe("album");
  });

  it("captures playlist when opening album from playlist", () => {
    expect(
      captureReturnContext(
        {
          view: "library",
          albumKey: null,
          artistKey: null,
          playlistId: 7,
          cdDriveId: null,
        },
        [playlist(7, "Road Trip")],
      ),
    ).toEqual({ kind: "playlist", playlistId: 7, title: "Road Trip" });
  });

  it("captures disc title when opening album from CD detail", () => {
    useCdStore.setState({
      drives: [
        { id: "drive-1", name: "HL-DT-ST BD-RE BP60NB10", hasDisc: true },
      ],
      discsByDriveId: {
        "drive-1": {
          driveId: "drive-1",
          album: "CALL ME IF YOU GET LOST",
          artist: "Tyler, The Creator",
          tracks: [],
        },
      },
    });

    expect(
      captureReturnContext(
        {
          view: "library",
          albumKey: null,
          artistKey: null,
          playlistId: null,
          cdDriveId: "drive-1",
        },
        [],
      ),
    ).toEqual({
      kind: "cd",
      driveId: "drive-1",
      title: "CALL ME IF YOU GET LOST",
    });
  });
});

describe("detailReturnLabel", () => {
  it("labels library return as Tracks", () => {
    expect(
      detailReturnLabel({ kind: "sidebar", view: "library" }, artists),
    ).toBe("Tracks");
  });

  it("labels artist return with artist name", () => {
    expect(
      detailReturnLabel({ kind: "artist", artistKey: "rage" }, artists),
    ).toBe("Rage Against the Machine");
  });

  it("labels album return with album title", () => {
    expect(
      detailReturnLabel(
        {
          kind: "album",
          albumKey: ALBUM_KEY,
          title: "The Battle of Los Angeles",
        },
        artists,
      ),
    ).toBe("The Battle of Los Angeles");
  });

  it("labels CD return with disc title, not drive name", () => {
    useCdStore.setState({
      drives: [
        { id: "drive-1", name: "HL-DT-ST BD-RE BP60NB10", hasDisc: true },
      ],
      discsByDriveId: {
        "drive-1": {
          driveId: "drive-1",
          album: "CALL ME IF YOU GET LOST",
          artist: "Tyler, The Creator",
          tracks: [],
        },
      },
    });

    expect(
      detailReturnLabel(
        {
          kind: "cd",
          driveId: "drive-1",
          title: "HL-DT-ST BD-RE BP60NB10",
        },
        artists,
      ),
    ).toBe("CALL ME IF YOU GET LOST");
  });

  it("labels unknown CD return as Unknown Disc, not drive name", () => {
    useCdStore.setState({
      drives: [
        { id: "drive-1", name: "HL-DT-ST BD-RE BP60NB10", hasDisc: true },
      ],
      discsByDriveId: {
        "drive-1": {
          driveId: "drive-1",
          album: null,
          artist: null,
          tracks: [],
        },
      },
    });

    expect(
      detailReturnLabel(
        {
          kind: "cd",
          driveId: "drive-1",
          title: "HL-DT-ST BD-RE BP60NB10",
        },
        artists,
      ),
    ).toBe("Unknown Disc");
  });
});

describe("stateAfterCloseAlbum", () => {
  it("restores library view after closing album opened from track list", () => {
    expect(stateAfterCloseAlbum({ kind: "sidebar", view: "library" })).toEqual({
      albumKey: null,
      artistKey: null,
      playlistId: null,
      cdDriveId: null,
      view: "library",
    });
  });

  it("restores artist detail after closing album opened from artist", () => {
    expect(stateAfterCloseAlbum({ kind: "artist", artistKey: "rage" })).toEqual(
      {
        albumKey: null,
        artistKey: "rage",
      },
    );
  });
});

describe("stateAfterCloseArtist", () => {
  it("restores library view after closing artist opened from track list", () => {
    expect(stateAfterCloseArtist({ kind: "sidebar", view: "library" })).toEqual(
      {
        artistKey: null,
        albumKey: null,
        playlistId: null,
        cdDriveId: null,
        view: "library",
      },
    );
  });

  it("restores artists list after closing artist opened from artists view", () => {
    expect(stateAfterCloseArtist({ kind: "sidebar", view: "artists" })).toEqual(
      {
        artistKey: null,
        albumKey: null,
        playlistId: null,
        cdDriveId: null,
        view: "artists",
      },
    );
  });

  it("restores album detail after closing artist opened from album", () => {
    expect(
      stateAfterCloseArtist({
        kind: "album",
        albumKey: ALBUM_KEY,
        title: "The Battle of Los Angeles",
      }),
    ).toEqual({
      artistKey: null,
      albumKey: ALBUM_KEY,
      playlistId: null,
      cdDriveId: null,
    });
  });
});

describe("stateAfterClosePlaylist", () => {
  it("restores library view after closing playlist opened from track list", () => {
    expect(
      stateAfterClosePlaylist({ kind: "sidebar", view: "library" }),
    ).toEqual({
      playlistId: null,
      artistKey: null,
      cdDriveId: null,
      view: "library",
    });
  });

  it("clears playlist when return context is absent", () => {
    expect(stateAfterClosePlaylist(null)).toEqual({ playlistId: null });
  });
});

describe("navigation stack unwind", () => {
  beforeEach(() => {
    useNavigationStore.setState({
      view: "library",
      albumKey: null,
      artistKey: null,
      playlistId: null,
      cdDriveId: null,
      albumReturnContext: null,
      artistReturnContext: null,
      playlistReturnContext: null,
      cdReturnContext: null,
    });
  });

  it("unwinds Tracks → Album → Artist → Album → Tracks", () => {
    const store = useNavigationStore.getState();

    store.openAlbum(ALBUM_KEY);
    expect(useNavigationStore.getState()).toMatchObject({
      albumKey: ALBUM_KEY,
      artistKey: null,
      albumReturnContext: { kind: "sidebar", view: "library" },
    });

    store.openArtist("rage");
    expect(useNavigationStore.getState()).toMatchObject({
      albumKey: null,
      artistKey: "rage",
      artistReturnContext: {
        kind: "album",
        albumKey: ALBUM_KEY,
        title: "The Battle of Los Angeles",
      },
      // Prior album return must survive so the second back hop works.
      albumReturnContext: { kind: "sidebar", view: "library" },
    });
    expect(
      detailReturnLabel(
        useNavigationStore.getState().artistReturnContext,
        artists,
      ),
    ).toBe("The Battle of Los Angeles");

    store.closeArtist();
    expect(useNavigationStore.getState()).toMatchObject({
      albumKey: ALBUM_KEY,
      artistKey: null,
      albumReturnContext: { kind: "sidebar", view: "library" },
      artistReturnContext: null,
    });

    store.closeAlbum();
    expect(useNavigationStore.getState()).toMatchObject({
      albumKey: null,
      artistKey: null,
      view: "library",
      albumReturnContext: null,
    });
  });

  it("unwinds Artists → Artist → Album → Artist → Artists", () => {
    const store = useNavigationStore.getState();
    store.setView("artists");

    store.openArtist("rage");
    expect(useNavigationStore.getState()).toMatchObject({
      artistKey: "rage",
      artistReturnContext: { kind: "sidebar", view: "artists" },
    });

    store.openAlbum(ALBUM_KEY);
    expect(useNavigationStore.getState()).toMatchObject({
      albumKey: ALBUM_KEY,
      artistKey: null,
      albumReturnContext: { kind: "artist", artistKey: "rage" },
      artistReturnContext: { kind: "sidebar", view: "artists" },
    });

    store.closeAlbum();
    expect(useNavigationStore.getState()).toMatchObject({
      albumKey: null,
      artistKey: "rage",
      albumReturnContext: null,
      artistReturnContext: { kind: "sidebar", view: "artists" },
    });

    store.closeArtist();
    expect(useNavigationStore.getState()).toMatchObject({
      artistKey: null,
      view: "artists",
      artistReturnContext: null,
    });
  });

  it("unwinds Playlist → Album → Artist → Album → Playlist", () => {
    const store = useNavigationStore.getState();

    store.openPlaylist(7);
    store.openAlbum(ALBUM_KEY);
    expect(useNavigationStore.getState()).toMatchObject({
      albumKey: ALBUM_KEY,
      playlistId: null,
      albumReturnContext: {
        kind: "playlist",
        playlistId: 7,
      },
    });

    store.openArtist("rage");
    expect(useNavigationStore.getState()).toMatchObject({
      artistKey: "rage",
      albumKey: null,
      artistReturnContext: {
        kind: "album",
        albumKey: ALBUM_KEY,
      },
      albumReturnContext: {
        kind: "playlist",
        playlistId: 7,
      },
    });

    store.closeArtist();
    expect(useNavigationStore.getState()).toMatchObject({
      albumKey: ALBUM_KEY,
      artistKey: null,
      artistReturnContext: null,
    });

    store.closeAlbum();
    expect(useNavigationStore.getState()).toMatchObject({
      albumKey: null,
      playlistId: 7,
      albumReturnContext: null,
    });
  });

  it("does not loop Artists → Artist → Album → Artist → back…", () => {
    const store = useNavigationStore.getState();
    store.setView("artists");

    store.openArtist("rage");
    store.openAlbum(ALBUM_KEY);
    // Re-open the same artist from the album (e.g. track artist link).
    // This overwrites artistReturnContext to the album.
    store.openArtist("rage");
    expect(useNavigationStore.getState()).toMatchObject({
      artistKey: "rage",
      albumKey: null,
      artistReturnContext: {
        kind: "album",
        albumKey: ALBUM_KEY,
      },
      albumReturnContext: { kind: "artist", artistKey: "rage" },
    });

    store.closeArtist();
    expect(useNavigationStore.getState()).toMatchObject({
      albumKey: ALBUM_KEY,
      artistKey: null,
      artistReturnContext: null,
      albumReturnContext: { kind: "artist", artistKey: "rage" },
    });

    store.closeAlbum();
    expect(useNavigationStore.getState()).toMatchObject({
      albumKey: null,
      artistKey: "rage",
      albumReturnContext: null,
      artistReturnContext: null,
    });

    store.closeArtist();
    expect(useNavigationStore.getState()).toMatchObject({
      artistKey: null,
      albumKey: null,
      view: "artists",
    });
  });
});
