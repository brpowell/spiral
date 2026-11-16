import { beforeEach, describe, expect, it, vi } from "vitest";

const getPrefs = vi.fn();
const savePrefs = vi.fn();

vi.mock("@/lib/tauri", () => ({
  getTrackListPreferences: (...args: unknown[]) => getPrefs(...args),
  saveTrackListPreferences: (...args: unknown[]) => savePrefs(...args),
}));

describe("track list preferences persistence", () => {
  beforeEach(() => {
    vi.resetModules();
    getPrefs.mockReset();
    savePrefs.mockReset();
  });

  it("keeps the source column hidden across loads", async () => {
    getPrefs.mockResolvedValue({
      columnWidths: {},
      hiddenColumnsByPreset: { library: ["year", "source"] },
      columnOrderByPreset: {},
    });
    const { loadTrackListPreferences, hiddenColumnIdsForPreset } =
      await import("./trackListPreferences");
    const prefs = await loadTrackListPreferences();
    expect(hiddenColumnIdsForPreset("library", prefs)).toContain("source");
  });

  it("keeps a saved source width and position", async () => {
    getPrefs.mockResolvedValue({
      columnWidths: { source: 200 },
      hiddenColumnsByPreset: {},
      columnOrderByPreset: { library: ["index", "source", "title"] },
    });
    const { loadTrackListPreferences } = await import("./trackListPreferences");
    const prefs = await loadTrackListPreferences();
    expect(prefs.columnWidths.source).toBe(200);
    expect(prefs.columnOrderByPreset.library).toContain("source");
  });
});
