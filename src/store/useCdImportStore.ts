import { create } from "zustand";
import { usePlayerStore } from "./usePlayerStore";
import type { Track } from "../types/track";

export interface CdImportProgress {
  driveId: string;
  /** Sorted disc track numbers selected for this import. */
  trackNumbers: number[];
  /** Track numbers finished importing (shown with a checkmark). */
  completedTrackNumbers: number[];
  /** Index into `trackNumbers` for the track currently being ripped. */
  ripIndex: number;
}

export function cdImportPendingTrackNumbers(
  progress: CdImportProgress,
): number[] {
  const completed = new Set(progress.completedTrackNumbers);
  return progress.trackNumbers.filter((number) => !completed.has(number));
}

export interface CdImportRowIndicators {
  importingTrackIds?: ReadonlySet<number>;
  activeTrackId: number | null;
  completedTrackIds?: ReadonlySet<number>;
}

export function cdImportRowIndicators(
  progress: CdImportProgress | null,
  completedDisplay: number[] | undefined,
  toListId: (trackNumber: number) => number,
): CdImportRowIndicators {
  const completedNumbers =
    progress?.completedTrackNumbers ?? completedDisplay ?? [];
  const completedTrackIds =
    completedNumbers.length > 0
      ? new Set(completedNumbers.map(toListId))
      : undefined;

  if (progress == null) {
    return {
      importingTrackIds: undefined,
      activeTrackId: null,
      completedTrackIds,
    };
  }

  const completed = new Set(progress.completedTrackNumbers);
  const importingTrackIds = new Set(
    cdImportPendingTrackNumbers(progress).map(toListId),
  );
  const activeTrackNumber = progress.trackNumbers[progress.ripIndex];
  const activeTrackId =
    activeTrackNumber == null || completed.has(activeTrackNumber)
      ? null
      : toListId(activeTrackNumber);

  return { importingTrackIds, activeTrackId, completedTrackIds };
}

export interface CdImportCancelPrompt {
  driveId: string;
  tracks: Track[];
}

export type CdImportCancelChoice = "keep" | "delete";

interface FinishImportOptions {
  preserveCompletedDisplay?: boolean;
}

interface CdImportState {
  progress: CdImportProgress | null;
  /** Set for the full import (rip + library commit); cleared in `finishImport`. */
  importingDriveId: string | null;
  /** Checkmarks for finished tracks; cleared when leaving the CD view. */
  completedDisplayByDriveId: Record<string, number[]>;
  cancelRequested: boolean;
  cancelPrompt: CdImportCancelPrompt | null;
  startImport: (driveId: string, trackNumbers: number[]) => void;
  setRipIndex: (index: number) => void;
  completeTrack: (trackNumber: number) => void;
  finishImport: (options?: FinishImportOptions) => void;
  clearCompletedDisplay: (driveId: string) => void;
  requestCancelImport: () => void;
  clearCancelRequest: () => void;
  setCancelPrompt: (prompt: CdImportCancelPrompt) => void;
  resolveCancelPrompt: (choice: CdImportCancelChoice) => Promise<void>;
}

export const useCdImportStore = create<CdImportState>((set, get) => ({
  progress: null,
  importingDriveId: null,
  completedDisplayByDriveId: {},
  cancelRequested: false,
  cancelPrompt: null,

  startImport: (driveId, trackNumbers) =>
    set((state) => {
      const { [driveId]: _removed, ...completedDisplayByDriveId } =
        state.completedDisplayByDriveId;
      return {
        importingDriveId: driveId,
        completedDisplayByDriveId,
        cancelRequested: false,
        cancelPrompt: null,
        progress: {
          driveId,
          trackNumbers,
          completedTrackNumbers: [],
          ripIndex: 0,
        },
      };
    }),

  setRipIndex: (index) =>
    set((state) => {
      if (state.progress == null) return state;
      return {
        progress: { ...state.progress, ripIndex: index },
      };
    }),

  completeTrack: (trackNumber) =>
    set((state) => {
      if (state.progress == null) return state;
      if (state.progress.completedTrackNumbers.includes(trackNumber)) {
        return state;
      }
      const completedTrackNumbers = [
        ...state.progress.completedTrackNumbers,
        trackNumber,
      ];
      return {
        progress: { ...state.progress, completedTrackNumbers },
      };
    }),

  finishImport: (options) =>
    set((state) => {
      const preserveCompletedDisplay = options?.preserveCompletedDisplay ?? true;
      const driveId = state.progress?.driveId ?? state.importingDriveId;
      const completed = state.progress?.completedTrackNumbers ?? [];
      const nextDisplay = { ...state.completedDisplayByDriveId };
      if (preserveCompletedDisplay && driveId != null && completed.length > 0) {
        nextDisplay[driveId] = completed;
      }
      return {
        progress: null,
        importingDriveId: null,
        completedDisplayByDriveId: nextDisplay,
      };
    }),

  clearCompletedDisplay: (driveId) =>
    set((state) => {
      if (!(driveId in state.completedDisplayByDriveId)) return state;
      const { [driveId]: _removed, ...completedDisplayByDriveId } =
        state.completedDisplayByDriveId;
      return { completedDisplayByDriveId };
    }),

  requestCancelImport: () => set({ cancelRequested: true }),

  clearCancelRequest: () => set({ cancelRequested: false }),

  setCancelPrompt: (prompt) => set({ cancelPrompt: prompt }),

  resolveCancelPrompt: async (choice) => {
    const prompt = get().cancelPrompt;
    if (prompt == null) return;

    set({ cancelPrompt: null });

    const trackNumbers = prompt.tracks
      .map((track) => track.trackNumber)
      .filter((number): number is number => number != null);

    if (choice === "keep") {
      if (trackNumbers.length > 0) {
        set((state) => ({
          completedDisplayByDriveId: {
            ...state.completedDisplayByDriveId,
            [prompt.driveId]: trackNumbers,
          },
        }));
      }
      await usePlayerStore.getState().loadLibrary();
      return;
    }

    const ids = prompt.tracks.map((track) => track.id);
    await usePlayerStore.getState().removeTracksFromLibrary(ids, true);
  },
}));
