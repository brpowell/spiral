import { describe, expect, it } from "vitest";
import { t } from "./i18n";
import { formatLyricsFormatLabel } from "./lyrics";
import { lyricsFetchFailureFeedback } from "./lyricsFetch";
import { mixedFieldPlaceholder, tracksToForm } from "./trackMetadataForm";
import {
  formatThemeValidationError,
  validateThemeForApply,
  validateThemeForSave,
} from "./themeValidation";
import { licenseStatusLabel } from "../types/license";
import type { Theme } from "../types/theme";
import type { Track } from "../types/track";

function track(partial: Partial<Track> & Pick<Track, "id">): Track {
  return {
    title: "T",
    artist: null,
    album: null,
    albumArtist: null,
    trackNumber: null,
    totalTracks: null,
    discNumber: null,
    totalDiscs: null,
    year: null,
    genre: null,
    durationSeconds: null,
    filePath: "/a.mp3",
    artPath: null,
    dateAdded: "2020-01-01T00:00:00Z",
    playCount: 0,
    lastPlayedAt: null,
    rating: 0,
    ...partial,
  };
}

function makeTheme(partial?: Partial<Theme>): Theme {
  return {
    id: "my-theme.theme",
    name: "My Theme",
    author: "",
    description: "",
    packId: "my-theme",
    authorId: "spiral",
    packName: "My Theme",
    packVersion: "0.0.0",
    zone: "workshop",
    mutable: true,
    tokens: {
      "color-bg": "#000",
      "color-surface": "#111",
      "color-text-primary": "#fff",
      "color-text-secondary": "#aaa",
      "color-accent": "#00f",
      "color-accent-muted": "#003",
      "color-border": "#222",
      "color-danger": "#f00",
      "radius-card": "8px",
      "radius-button": "4px",
      "font-ui": "system-ui",
    },
    ...partial,
  };
}

describe("i18n Phase 5 catalogs", () => {
  it("resolves editor chrome, fields, and plurals", () => {
    expect(t("library:editor.editArtist")).toBe("Edit artist");
    expect(t("library:editor.editTracks", { count: 3 })).toBe("Edit 3 tracks");
    expect(t("library:editor.tabArt")).toBe("Art");
    expect(t("library:editor.chooseFromFile")).toBe("Choose from file");
    expect(t("library:editor.fields.albumArtist")).toBe("Album Artist");
    expect(t("library:editor.lyrics.fetch")).toBe("Fetch lyrics");
    expect(t("common:save")).toBe("Save");
    expect(t("common:discardChanges")).toBe("Discard changes?");
  });

  it("resolves preferences body and relocate plurals", () => {
    expect(t("preferences:title")).toBe("Preferences");
    expect(t("preferences:library.importCopy")).toBe("Copy into library");
    expect(t("preferences:listening.record")).toBe("Record listening history");
    expect(t("preferences:relocate.importFound", { count: 1 })).toBe(
      "Import 1 found file",
    );
    expect(t("preferences:relocate.importFound", { count: 8 })).toBe(
      "Import 8 found files",
    );
  });

  it("resolves Studio and Spiral Card copy", () => {
    expect(t("studio:nav.themes")).toBe("Themes");
    expect(t("studio:themes.editorTitle", { name: "Obsidian" })).toBe(
      "Edit theme (Obsidian)",
    );
    expect(t("studio:themeEditor.validation.nameRequired")).toBe(
      "Name is required to apply a theme.",
    );
    expect(t("common:spiralCard.titleTrial")).toBe(
      "Unlock the full experience",
    );
    expect(t("common:spiralCard.submit")).toBe("Submit & finalize");
  });
});

describe("Phase 5 helpers use catalogs", () => {
  it("uses mixed-value placeholder from catalogs", () => {
    const tracks = [track({ id: 1, title: "A" }), track({ id: 2, title: "B" })];
    const form = tracksToForm(tracks);
    expect(mixedFieldPlaceholder(tracks, "title", form)).toBe(
      "Multiple values",
    );
  });

  it("formats lyrics labels from catalogs", () => {
    expect(formatLyricsFormatLabel("line_synced")).toBe("Line Synced");
    expect(formatLyricsFormatLabel("instrumental")).toBe("Instrumental");
  });

  it("maps lyrics fetch failures through catalogs", () => {
    expect(lyricsFetchFailureFeedback(new Error("network timeout")).text).toBe(
      "Couldn't reach LRCLIB. Check your connection and try again.",
    );
  });

  it("formats theme validation from catalogs", () => {
    const saveIssues = validateThemeForSave(makeTheme({ mutable: false }));
    expect(saveIssues[0]?.message).toBe("Only mutable drafts can be saved.");

    const applyIssues = validateThemeForApply(
      makeTheme({ name: "", tokens: {} }),
    );
    expect(formatThemeValidationError(applyIssues)).toMatch(/\+\d+ more/);
    expect(applyIssues.some((i) => i.field === "name")).toBe(true);
  });

  it("resolves license status labels from catalogs", () => {
    expect(licenseStatusLabel("trial")).toBe("Trial");
    expect(licenseStatusLabel("licensed")).toBe("Permanent");
  });
});
