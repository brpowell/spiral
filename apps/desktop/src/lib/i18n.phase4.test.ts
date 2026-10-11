import { describe, expect, it } from "vitest";
import { t } from "./i18n";

describe("i18n Phase 4 catalogs", () => {
  it("resolves browse view titles and empty states", () => {
    expect(t("library:views.tracks.title")).toBe("Tracks");
    expect(t("library:views.albums.emptySearch")).toBe(
      "No albums match your search.",
    );
    expect(t("library:empty.title")).toBe("Add some music");
  });

  it("uses plural forms for track/album counts", () => {
    expect(t("library:counts.tracks", { count: 1 })).toBe("1 track");
    expect(t("library:counts.tracks", { count: 4 })).toBe("4 tracks");
    expect(t("library:counts.albums", { count: 1 })).toBe("1 album");
    expect(t("library:counts.albums", { count: 2 })).toBe("2 albums");
  });

  it("uses plural forms for queue and library actions", () => {
    expect(t("library:actions.addToQueue")).toBe("Add to Queue");
    expect(t("library:actions.addToQueue", { count: 1 })).toBe("Add to Queue");
    expect(t("library:actions.addToQueue", { count: 8 })).toBe(
      "Add 8 to Queue",
    );
    expect(t("library:actions.removeFromLibrary", { count: 1 })).toBe(
      "Remove from Library",
    );
    expect(t("library:actions.removeFromLibrary", { count: 3 })).toBe(
      "Remove 3 from Library",
    );
    expect(t("library:actions.convert", { count: 1 })).toBe("Convert…");
    expect(t("library:actions.convert", { count: 2 })).toBe(
      "Convert 2 Tracks…",
    );
  });

  it("resolves playback transport a11y labels", () => {
    expect(t("playback:transport.previous")).toBe("Previous track");
    expect(t("playback:transport.shuffleOn")).toBe("Turn shuffle on");
    expect(t("playback:nowPlaying.aria")).toBe("Now playing");
    expect(t("playback:queue.view")).toBe("View set list");
  });

  it("uses plural forms for remove/convert/import dialogs", () => {
    expect(t("dialogs:removeTracks.title", { count: 1 })).toBe(
      "Remove from library?",
    );
    expect(t("dialogs:removeTracks.title", { count: 5 })).toBe(
      "Remove 5 tracks from library?",
    );
    expect(t("dialogs:removeTracks.deleteFiles", { count: 1 })).toBe(
      "Remove and delete file",
    );
    expect(t("dialogs:removeTracks.deleteFiles", { count: 2 })).toBe(
      "Remove and delete files",
    );
    expect(t("dialogs:convert.title", { count: 1 })).toBe("Convert track");
    expect(t("dialogs:convert.title", { count: 4 })).toBe("Convert 4 tracks");
    expect(t("dialogs:importDedupe.applyRemaining", { count: 1 })).toBe(
      "Apply to remaining duplicate in this import",
    );
    expect(t("dialogs:importDedupe.applyRemaining", { count: 3 })).toBe(
      "Apply to remaining 3 duplicates in this import",
    );
    expect(t("dialogs:cdImportCancel.keepQuestion", { count: 1 })).toBe(
      "Keep this imported track in your library?",
    );
    expect(t("dialogs:cdImportCancel.keepQuestion", { count: 2 })).toBe(
      "Keep these 2 imported tracks in your library?",
    );
  });
});
