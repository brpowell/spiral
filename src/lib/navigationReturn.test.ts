import { describe, expect, it } from "vitest";
import {
  captureReturnContext,
  detailReturnLabel,
  stateAfterCloseAlbum,
  stateAfterCloseArtist,
  stateAfterClosePlaylist,
} from "./navigationReturn";
import { useCdStore } from "../store/useCdStore";
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
      drives: [{ id: "drive-1", name: "HL-DT-ST BD-RE BP60NB10", hasDisc: true }],
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

  it("labels CD return with disc title, not drive name", () => {
    useCdStore.setState({
      drives: [{ id: "drive-1", name: "HL-DT-ST BD-RE BP60NB10", hasDisc: true }],
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
});

describe("stateAfterCloseAlbum", () => {
  it("restores library view after closing album opened from track list", () => {
    expect(
      stateAfterCloseAlbum({ kind: "sidebar", view: "library" }),
    ).toEqual({
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
    expect(
      stateAfterCloseArtist({ kind: "sidebar", view: "library" }),
    ).toEqual({
      artistKey: null,
      playlistId: null,
      cdDriveId: null,
      view: "library",
    });
  });

  it("restores artists list after closing artist opened from artists view", () => {
    expect(
      stateAfterCloseArtist({ kind: "sidebar", view: "artists" }),
    ).toEqual({
      artistKey: null,
      playlistId: null,
      cdDriveId: null,
      view: "artists",
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

  it("restores previous playlist when switching playlists in sidebar", () => {
    expect(
      stateAfterClosePlaylist({
        kind: "playlist",
        playlistId: 3,
        title: "Dingo",
      }),
    ).toEqual({
      playlistId: 3,
    });
  });
});

describe("captureReturnContext for playlists", () => {
  it("captures sidebar view when opening playlist from tracks", () => {
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
});
