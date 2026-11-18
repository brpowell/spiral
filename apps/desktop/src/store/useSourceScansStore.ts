import { create } from "zustand";
import type { ScanProgress } from "@/types/source";

interface SourceScansState {
  /** Sources whose first scan, after adding them, is still running. */
  scanning: ReadonlySet<number>;
  /** How far each scanning source has got, once it reports. */
  progress: Readonly<Record<number, ScanProgress>>;
  begin: (sourceId: number) => void;
  end: (sourceId: number) => void;
  setProgress: (sourceId: number, progress: ScanProgress | null) => void;
}

export const useSourceScansStore = create<SourceScansState>((set) => ({
  scanning: new Set(),
  progress: {},
  begin: (sourceId) =>
    set((s) => ({ scanning: new Set(s.scanning).add(sourceId) })),
  end: (sourceId) =>
    set((s) => {
      const scanning = new Set(s.scanning);
      scanning.delete(sourceId);
      const { [sourceId]: _gone, ...progress } = s.progress;
      return { scanning, progress };
    }),
  setProgress: (sourceId, progress) =>
    set((s) => {
      if (progress)
        return { progress: { ...s.progress, [sourceId]: progress } };
      const { [sourceId]: _gone, ...rest } = s.progress;
      return { progress: rest };
    }),
}));
