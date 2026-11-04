import { create } from "zustand";
import { getSourceStatuses, listSources } from "../lib/tauri";
import type { Source, SourceWatchStatus } from "../types/source";

interface SourcesState {
  sources: Source[];
  sourcesById: ReadonlyMap<number, Source>;
  /** Watch status per watched source id; missing until first loaded. */
  statuses: Readonly<Record<number, SourceWatchStatus>>;
  loaded: boolean;
  loadSources: () => Promise<void>;
  loadStatuses: () => Promise<void>;
  /** Replace one source after a command returned its new row. */
  applySource: (source: Source) => void;
}

function byId(sources: Source[]): ReadonlyMap<number, Source> {
  return new Map(sources.map((source) => [source.id, source]));
}

export const useSourcesStore = create<SourcesState>((set, get) => ({
  sources: [],
  sourcesById: new Map(),
  statuses: {},
  loaded: false,

  loadSources: async () => {
    try {
      const sources = await listSources();
      set({ sources, sourcesById: byId(sources), loaded: true });
    } catch (err) {
      console.error("listSources failed:", err);
    }
    await get().loadStatuses();
  },

  loadStatuses: async () => {
    try {
      const list = await getSourceStatuses();
      set({
        statuses: Object.fromEntries(
          list.map((entry) => [entry.sourceId, entry.status]),
        ),
      });
    } catch (err) {
      console.error("getSourceStatuses failed:", err);
    }
  },

  applySource: (source) => {
    const exists = get().sources.some((s) => s.id === source.id);
    const sources = exists
      ? get().sources.map((s) => (s.id === source.id ? source : s))
      : [...get().sources, source];
    set({ sources, sourcesById: byId(sources) });
  },
}));
