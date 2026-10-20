import { create } from "zustand";
import type { ItemType } from "../types/item";
import type { CatalogSort } from "../types/itemRegistry";

interface CatalogViewState {
  /** Selected types; empty means every type. */
  typeFilters: ItemType[];
  sort: CatalogSort;
  searchText: string;
  /** Catalog item open in the details view, if any. */
  selectedKey: string | null;
  /** Scroll offset of the catalog list. */
  scrollTop: number;
  setTypeFilters: (
    next: ItemType[] | ((current: ItemType[]) => ItemType[]),
  ) => void;
  setSort: (sort: CatalogSort) => void;
  setSearchText: (searchText: string) => void;
  setSelectedKey: (key: string | null) => void;
  setScrollTop: (scrollTop: number) => void;
}

const INITIAL = {
  typeFilters: [] as ItemType[],
  sort: "name" as CatalogSort,
  searchText: "",
  selectedKey: null as string | null,
  scrollTop: 0,
};

/**
 * Where the user left off in the Studio catalog (filters, search, open item, scroll), kept
 * outside the view so leaving to another Studio section and coming back restores it.
 */
export const useCatalogViewStore = create<CatalogViewState>((set) => ({
  ...INITIAL,
  setTypeFilters: (next) =>
    set((s) => ({
      typeFilters: typeof next === "function" ? next(s.typeFilters) : next,
    })),
  setSort: (sort) => set({ sort }),
  setSearchText: (searchText) => set({ searchText }),
  setSelectedKey: (selectedKey) => set({ selectedKey }),
  setScrollTop: (scrollTop) => set({ scrollTop }),
}));

/** Forget where the user left off (tests). */
export function resetCatalogView(): void {
  useCatalogViewStore.setState(INITIAL);
}
