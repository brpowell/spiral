import { create } from "zustand";
import {
  hasCompletedOnboarding,
  markOnboardingCompleted,
} from "../lib/onboardingPreferences";
import { organizeInBackground } from "../lib/organizeSource";
import { createManagedSource, getLibrary, removeSource } from "../lib/tauri";
import { useLibrarySettingsStore } from "./useLibrarySettingsStore";
import { useSourcesStore } from "./useSourcesStore";

/** How the user answered "Where does your music live?" on the first step. */
export type MusicChoice = "new" | "existing";

export type OnboardingStepId = "library" | "folders" | "style" | "privacy";

/** The welcome steps in order; picking folders only appears for existing music. */
export function onboardingSteps(
  choice: MusicChoice | null,
): readonly OnboardingStepId[] {
  return choice === "existing"
    ? ["library", "folders", "style", "privacy"]
    : ["library", "style", "privacy"];
}

interface OnboardingState {
  /** True while the onboarding overlay is mounted over the library. */
  open: boolean;
  /** Zero-based index of the visible welcome step. */
  step: number;
  /** The first step's answer; null until the user picks one. */
  musicChoice: MusicChoice | null;
  /** Sources added on the folders step this run, which it may remove again. */
  addedSourceIds: readonly number[];
  /**
   * The empty `Tracks` a new library starts with, while it stands in for the
   * folders the user picks: hidden on the folders step, and removed once
   * they've added one of their own.
   */
  placeholderSourceId: number | null;
  /** Show onboarding now. */
  start: () => void;
  setMusicChoice: (choice: MusicChoice) => void;
  /**
   * Act on the first step's answer before moving on: "new" has Spiral manage
   * a `Tracks` folder; "existing" sets aside the empty `Tracks` a new library
   * starts with, so only the folders the user picks are shown.
   */
  applyMusicChoice: () => Promise<void>;
  /**
   * Leaving the folders step: once the user has a folder of their own, drop
   * the placeholder `Tracks`. Their first folder becomes the default.
   */
  settleFolders: () => Promise<void>;
  noteSourceAdded: (id: number) => void;
  noteSourceRemoved: (id: number) => void;
  next: () => void;
  back: () => void;
  /**
   * Dismiss onboarding and remember that it has been seen. Folders added with
   * organizing on are organized now, in the background (the folders step
   * only records the choice, so nothing moves mid-onboarding).
   */
  finish: () => void;
}

export const useOnboardingStore = create<OnboardingState>((set, get) => ({
  open: !hasCompletedOnboarding(),
  step: 0,
  musicChoice: null,
  addedSourceIds: [],
  placeholderSourceId: null,
  start: () =>
    set({
      open: true,
      step: 0,
      musicChoice: null,
      addedSourceIds: [],
      placeholderSourceId: null,
    }),
  setMusicChoice: (musicChoice) => set({ musicChoice }),
  applyMusicChoice: async () => {
    const { musicChoice } = get();
    const sources = useSourcesStore.getState();
    if (musicChoice === "new") {
      sources.applySource(await createManagedSource());
      set({ placeholderSourceId: null });
    } else if (musicChoice === "existing") {
      await sources.loadSources();
      set({ placeholderSourceId: await findPlaceholderSource() });
    }
  },
  settleFolders: async () => {
    const placeholder = get().placeholderSourceId;
    if (placeholder == null) return;
    const others = useSourcesStore
      .getState()
      .sources.filter((source) => source.id !== placeholder);
    if (others.length === 0) return;
    // A scan may have found music in it since it was set aside.
    if (!(await hasNoTracks(placeholder))) {
      set({ placeholderSourceId: null });
      return;
    }
    // Removing the default makes the lowest-id reachable folder the default:
    // the first one the user added.
    await removeSource(placeholder);
    set({ placeholderSourceId: null });
    await useSourcesStore.getState().loadSources();
  },
  noteSourceAdded: (id) =>
    set((s) => ({ addedSourceIds: [...s.addedSourceIds, id] })),
  noteSourceRemoved: (id) =>
    set((s) => ({ addedSourceIds: s.addedSourceIds.filter((x) => x !== id) })),
  next: () =>
    set((s) => ({
      step: Math.min(s.step + 1, onboardingSteps(s.musicChoice).length - 1),
    })),
  back: () => set((s) => ({ step: Math.max(s.step - 1, 0) })),
  finish: () => {
    markOnboardingCompleted();
    set({ open: false });
    void get()
      .settleFolders()
      .catch((err) => console.error("settleFolders failed:", err));
    const added = new Set(get().addedSourceIds);
    const jobs = useSourcesStore
      .getState()
      .sources.filter((source) => added.has(source.id) && source.autoOrganize)
      .map((source) => ({ source }));
    if (jobs.length > 0) void organizeInBackground(jobs, { scanFirst: true });
  },
}));

/**
 * The library's only source, when it's the managed `Tracks` with no tracks:
 * the folder a new library starts with, not one the user chose.
 */
async function findPlaceholderSource(): Promise<number | null> {
  const sources = useSourcesStore.getState().sources;
  const tracksFolder = useLibrarySettingsStore.getState().settings?.mediaFolder;
  if (sources.length !== 1 || tracksFolder == null) return null;
  const [only] = sources;
  if (only.rootPath !== tracksFolder) return null;
  return (await hasNoTracks(only.id)) ? only.id : null;
}

/**
 * Whether a source has no tracks, asked of the backend: the player store's
 * library is empty until it loads. Unknown counts as having tracks, because
 * removing a source removes its tracks' rows.
 */
async function hasNoTracks(sourceId: number): Promise<boolean> {
  try {
    const tracks = await getLibrary();
    return !tracks.some((track) => track.sourceId === sourceId);
  } catch (err) {
    console.error("getLibrary failed:", err);
    return false;
  }
}
