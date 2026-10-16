import { create } from "zustand";

/**
 * Bumped whenever the set of items on disk may have changed (install, uninstall,
 * hide, edit, link). Views backed by `listItems()` rather than a dedicated store
 * refetch when it changes.
 */
export const useItemsVersionStore = create<{
  version: number;
  bump: () => void;
}>((set) => ({
  version: 0,
  bump: () => set((s) => ({ version: s.version + 1 })),
}));
