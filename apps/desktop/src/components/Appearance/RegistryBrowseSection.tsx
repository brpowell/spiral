import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { viewTransition } from "../../lib/motion";
import {
  catalogCacheKey,
  catalogItemKey,
  enrichItemCatalog,
  fetchItemCatalogSafe,
  installCatalogEntry,
  prefetchItemDetail,
} from "../../lib/itemRegistry";
import { useCatalogViewStore } from "../../store/useCatalogViewStore";
import { useItemsVersionStore } from "../../store/useItemsVersionStore";
import { ITEM_TYPES, type ItemType } from "../../types/item";
import {
  CATALOG_SORTS,
  type CatalogItemEntry,
  type CatalogSort,
  type RegistryVersionSummary,
} from "../../types/itemRegistry";
import { BrowseGridBody } from "../BrowseView/BrowseGridBody";
import { BrowseView } from "../BrowseView/BrowseView";
import { BrowseViewHeader } from "../BrowseView/BrowseViewHeader";
import { Button } from "../common/Button/Button";
import { EmptyState } from "../common/EmptyState/EmptyState";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "../common/InputGroup/InputGroup";
import { Skeleton } from "../common/Skeleton/Skeleton";
import { Select } from "../common/Select/Select";
import {
  ContextMenuCheckboxItem,
  ContextMenuItem,
  ContextMenuSeparator,
} from "../ContextMenu/ContextMenu";
import {
  IconArrowUpDown,
  IconDisconnected,
  IconListFilter,
  IconListX,
  IconSearch,
} from "../icons";
import { MenuButton } from "../MenuButton/MenuButton";
import { itemTypeMeta } from "./itemShared";
import { RegistryItemCard } from "./RegistryItemCard";
import { RegistryItemDetailView } from "./RegistryItemDetailView";
import "./AppearanceSection.css";
import "./RegistryBrowse.css";

/** Items per catalog request; "Load more" fetches the next page. */
export const CATALOG_PAGE_SIZE = 48;
const SEARCH_DEBOUNCE_MS = 300;

type Snapshot = {
  entries: CatalogItemEntry[];
  total: number;
  partialWarning: boolean;
};

/** First page per filter, so switching Studio sections or filters repaints instantly. */
const snapshots = new Map<string, Snapshot>();

/** Forget the remembered first pages (tests; or after the registry list changes). */
export function resetCatalogSnapshots(): void {
  snapshots.clear();
}

function snapshotKey(
  itemTypes: ItemType[],
  q: string,
  sort: CatalogSort,
): string {
  return catalogCacheKey({
    itemTypes,
    q,
    sort,
    limit: CATALOG_PAGE_SIZE,
    offset: 0,
  });
}

function CatalogCardSkeleton() {
  return (
    <div
      className="appearance-pack-card registry-browse__card-skeleton"
      aria-hidden
    >
      <div className="appearance-pack-card__surface">
        <Skeleton
          className="registry-browse__card-skeleton-preview"
          radius="md"
          height="100%"
          width="100%"
        />
        <div className="appearance-pack-card__meta">
          <Skeleton width="70%" height="0.88rem" radius="sm" />
          <Skeleton width="45%" height="0.75rem" radius="sm" />
          <Skeleton width="90%" height="0.75rem" radius="sm" />
        </div>
      </div>
    </div>
  );
}

function CatalogGridSkeleton() {
  const { t } = useTranslation("studio");
  return (
    <div
      className="appearance-pack-grid"
      role="status"
      aria-busy="true"
      aria-label={t("catalog.loading")}
    >
      {Array.from({ length: 8 }, (_, i) => (
        <CatalogCardSkeleton key={i} />
      ))}
    </div>
  );
}

/** Merge a fresh page into the list by registry + effective id, keeping first-seen order. */
function appendUnique(
  current: CatalogItemEntry[],
  next: CatalogItemEntry[],
): CatalogItemEntry[] {
  const seen = new Set(current.map(catalogItemKey));
  return [...current, ...next.filter((e) => !seen.has(catalogItemKey(e)))];
}

export function RegistryBrowseSection() {
  const { t } = useTranslation(["studio", "library"]);
  /** Selected types; empty means every type. */
  const typeFilters = useCatalogViewStore((s) => s.typeFilters);
  const setTypeFilters = useCatalogViewStore((s) => s.setTypeFilters);
  const sort = useCatalogViewStore((s) => s.sort);
  const setSort = useCatalogViewStore((s) => s.setSort);
  const searchText = useCatalogViewStore((s) => s.searchText);
  const setSearchText = useCatalogViewStore((s) => s.setSearchText);
  const selectedKey = useCatalogViewStore((s) => s.selectedKey);
  const setSelectedKey = useCatalogViewStore((s) => s.setSelectedKey);
  const setScrollTop = useCatalogViewStore((s) => s.setScrollTop);
  const [query, setQuery] = useState(() =>
    useCatalogViewStore.getState().searchText.trim(),
  );
  const [entries, setEntries] = useState<CatalogItemEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [partialWarning, setPartialWarning] = useState(false);
  const [busy, setBusy] = useState(false);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  /** Latest request wins; older responses are dropped. */
  const requestRef = useRef(0);
  const itemsVersion = useItemsVersionStore((s) => s.version);

  // Debounce the search box into the server query.
  useEffect(() => {
    const handle = setTimeout(
      () => setQuery(searchText.trim()),
      SEARCH_DEBOUNCE_MS,
    );
    return () => clearTimeout(handle);
  }, [searchText]);

  const loadFirstPage = useCallback(
    async (force = false) => {
      const requestId = ++requestRef.current;
      const stale = () => requestRef.current !== requestId;
      const snapshot = snapshots.get(snapshotKey(typeFilters, query, sort));

      setError(null);
      if (snapshot) {
        setEntries(snapshot.entries);
        setTotal(snapshot.total);
        setPartialWarning(snapshot.partialWarning);
        setLoading(false);
      } else {
        setEntries([]);
        setTotal(0);
        setPartialWarning(false);
        setLoading(true);
      }

      const result = await fetchItemCatalogSafe({
        itemTypes: typeFilters,
        q: query,
        sort,
        limit: CATALOG_PAGE_SIZE,
        offset: 0,
        force,
      });
      if (stale()) return;
      if (!result.ok) {
        if (!snapshot) {
          setError(result.error);
          setLoading(false);
        }
        return;
      }

      const partial = (result.catalog.errors?.length ?? 0) > 0;
      if (!snapshot) {
        // Show cards as soon as the page lands; previews fill in below.
        const quick = await enrichItemCatalog(result.catalog.items, {
          resolvePreviews: false,
        });
        if (stale()) return;
        setEntries(quick);
        setTotal(result.catalog.total);
        setPartialWarning(partial);
        setLoading(false);
      }
      const full = await enrichItemCatalog(result.catalog.items);
      if (stale()) return;
      setEntries(full);
      setTotal(result.catalog.total);
      setPartialWarning(partial);
      snapshots.set(snapshotKey(typeFilters, query, sort), {
        entries: full,
        total: result.catalog.total,
        partialWarning: partial,
      });
    },
    [typeFilters, query, sort],
  );

  // A new filter, search or sort starts over; the first run (including a return to the
  // catalog) keeps the remembered open item and scroll position.
  const lastLoadRef = useRef(loadFirstPage);
  useEffect(() => {
    if (lastLoadRef.current !== loadFirstPage) {
      lastLoadRef.current = loadFirstPage;
      setSelectedKey(null);
      setScrollTop(0);
    }
    void loadFirstPage();
  }, [loadFirstPage, setSelectedKey, setScrollTop]);

  const loadMore = useCallback(async () => {
    setLoadingMore(true);
    const requestId = requestRef.current;
    try {
      const result = await fetchItemCatalogSafe({
        itemTypes: typeFilters,
        q: query,
        sort,
        limit: CATALOG_PAGE_SIZE,
        offset: entriesRef.current.length,
      });
      if (requestRef.current !== requestId || !result.ok) return;
      const next = await enrichItemCatalog(result.catalog.items);
      if (requestRef.current !== requestId) return;
      setEntries((current) => appendUnique(current, next));
      setTotal(result.catalog.total);
    } finally {
      setLoadingMore(false);
    }
  }, [typeFilters, query, sort]);

  // Installs, uninstalls and hides elsewhere change what is installed: re-read local state
  // for the rows we already have, without refetching the catalog or its previews.
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const current = entriesRef.current;
    if (current.length === 0) return;
    let cancelled = false;
    void enrichItemCatalog(current, { resolvePreviews: false }).then(
      (refreshed) => {
        if (cancelled) return;
        const previews = new Map(
          current.map((e) => [catalogItemKey(e), e.resolvedPreviewUrl]),
        );
        setEntries(
          refreshed.map((e) => ({
            ...e,
            resolvedPreviewUrl: previews.get(catalogItemKey(e)) ?? null,
          })),
        );
      },
    );
    return () => {
      cancelled = true;
    };
  }, [itemsVersion]);

  const selectedEntry = useMemo(
    () =>
      selectedKey == null
        ? null
        : (entries.find((e) => catalogItemKey(e) === selectedKey) ?? null),
    [entries, selectedKey],
  );

  /** Install the newest version, or a chosen one (also how an update and a downgrade run). */
  const install = useCallback(
    async (entry: CatalogItemEntry, version?: RegistryVersionSummary) => {
      setBusy(true);
      try {
        await installCatalogEntry(entry, version);
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  // Put the list back where it was left once its cards are on screen.
  const listBodyRef = useRef<HTMLDivElement | null>(null);
  const restoreScrollRef = useRef(false);
  const attachListBody = useCallback((el: HTMLDivElement | null) => {
    listBodyRef.current = el;
    if (el == null) return;
    if (entriesRef.current.length > 0) {
      el.scrollTop = useCatalogViewStore.getState().scrollTop;
    } else {
      restoreScrollRef.current = true;
    }
  }, []);
  useEffect(() => {
    const el = listBodyRef.current;
    if (!restoreScrollRef.current || el == null || entries.length === 0) return;
    restoreScrollRef.current = false;
    el.scrollTop = useCatalogViewStore.getState().scrollTop;
  }, [entries]);

  const showSkeleton = loading && entries.length === 0;
  const hasMore = entries.length < total;
  const filtered = typeFilters.length > 0 || query !== "";

  // Checking types edits a draft; the filter is applied once the menu closes, so the grid
  // reloads once per visit to the menu instead of once per click.
  const [draftFilters, setDraftFilters] = useState<ItemType[]>(typeFilters);
  const draftFiltersRef = useRef(draftFilters);
  draftFiltersRef.current = draftFilters;
  const toggleType = (type: ItemType) =>
    setDraftFilters((current) =>
      current.includes(type)
        ? current.filter((t) => t !== type)
        : [...current, type],
    );
  const handleFilterMenuOpenChange = (open: boolean) => {
    if (open) {
      setDraftFilters(typeFilters);
      return;
    }
    const draft = draftFiltersRef.current;
    const changed =
      draft.length !== typeFilters.length ||
      draft.some((type) => !typeFilters.includes(type));
    if (changed) setTypeFilters(draft);
  };
  const typeLabel = (type: ItemType) =>
    t(`catalog.typePlural.${type}`, { defaultValue: itemTypeMeta(type).label });
  const typeOptions = ITEM_TYPES.map((type) => ({
    value: type,
    label: typeLabel(type),
    icon: itemTypeMeta(type).icon,
  }));
  const sortOptions = CATALOG_SORTS.map((value) => ({
    value,
    label: t(`catalog.sort.${value}`),
  }));

  return (
    <div className="registry-browse">
      <AnimatePresence mode="wait">
        {selectedEntry ? (
          <motion.div
            key={`detail-${selectedKey}`}
            className="registry-browse__detail-wrap"
            {...viewTransition}
          >
            <RegistryItemDetailView
              entry={selectedEntry}
              busy={busy}
              backAriaLabel={t("backTo", { section: t("catalog.title") })}
              onBack={() => setSelectedKey(null)}
              onInstall={(version) => install(selectedEntry, version)}
            />
          </motion.div>
        ) : (
          <motion.div
            key="list"
            className="registry-browse__list"
            {...viewTransition}
          >
            <BrowseView>
              <BrowseViewHeader
                className="browse-view__header--single-row"
                title={t("catalog.title")}
                count={
                  !showSkeleton && !error
                    ? t("library:views.headerCount", { count: total })
                    : undefined
                }
              />
              <div className="registry-browse__toolbar">
                <InputGroup className="registry-browse__search">
                  <InputGroupInput
                    type="text"
                    value={searchText}
                    placeholder={t("catalog.searchPlaceholder")}
                    aria-label={t("catalog.searchAria")}
                    onChange={(e) => setSearchText(e.target.value)}
                    onEscape={() => setSearchText("")}
                  />
                  <InputGroupAddon>
                    <IconSearch />
                  </InputGroupAddon>
                </InputGroup>
                <MenuButton
                  className="registry-browse__filter"
                  ariaLabel={
                    typeFilters.length > 0
                      ? t("catalog.filterAriaActive", {
                          count: typeFilters.length,
                        })
                      : t("catalog.filterAria")
                  }
                  title={t("catalog.filterAria")}
                  icon={
                    <span className="registry-browse__filter-icon">
                      <IconListFilter />
                      {typeFilters.length > 0 ? (
                        <span
                          className="registry-browse__filter-count"
                          aria-hidden
                        >
                          {typeFilters.length}
                        </span>
                      ) : null}
                    </span>
                  }
                  variant="secondary"
                  size="sm"
                  triggerPlacement="below-start"
                  layoutDeps={[draftFilters]}
                  onOpenChange={handleFilterMenuOpenChange}
                >
                  {(close) => (
                    <>
                      {typeOptions.map((opt) => (
                        <ContextMenuCheckboxItem
                          key={opt.value}
                          icon={opt.icon}
                          label={opt.label}
                          checked={draftFilters.includes(opt.value)}
                          onClick={() => toggleType(opt.value)}
                        />
                      ))}
                      {draftFilters.length > 0 ? (
                        <>
                          <ContextMenuSeparator />
                          <ContextMenuItem
                            icon={<IconListX />}
                            label={t("catalog.filterClear")}
                            onClick={() => {
                              setDraftFilters([]);
                              close();
                            }}
                          />
                        </>
                      ) : null}
                    </>
                  )}
                </MenuButton>
                <Select
                  className="registry-browse__sort"
                  value={sort}
                  onChange={setSort}
                  icon={<IconArrowUpDown />}
                  options={sortOptions}
                  aria-label={t("catalog.sortAria")}
                />
              </div>
              <BrowseGridBody
                bodyRef={attachListBody}
                onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
              >
                {partialWarning && !error ? (
                  <p className="registry-browse__banner appearance-section__status">
                    {t("catalog.partialErrors")}
                  </p>
                ) : null}
                {showSkeleton ? (
                  <CatalogGridSkeleton />
                ) : error && entries.length === 0 ? (
                  <div className="registry-browse__error" role="alert">
                    <EmptyState
                      icon={<IconDisconnected />}
                      title={t("catalog.unreachableTitle")}
                      description={t("catalog.unreachableDescription")}
                      action={
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => void loadFirstPage(true)}
                        >
                          {t("catalog.retry")}
                        </Button>
                      }
                    />
                  </div>
                ) : entries.length === 0 ? (
                  <p className="browse-view__empty">
                    {filtered ? t("catalog.emptyFiltered") : t("catalog.empty")}
                  </p>
                ) : (
                  <>
                    <div className="appearance-pack-grid" role="list">
                      {entries.map((entry) => {
                        const key = catalogItemKey(entry);
                        return (
                          <div
                            key={key}
                            role="listitem"
                            onPointerEnter={() => prefetchItemDetail(entry)}
                            onFocus={() => prefetchItemDetail(entry)}
                          >
                            <RegistryItemCard
                              entry={entry}
                              busy={busy}
                              onOpen={() => setSelectedKey(key)}
                              onUpdate={() => void install(entry)}
                            />
                          </div>
                        );
                      })}
                    </div>
                    {hasMore ? (
                      <div className="registry-browse__more">
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={loadingMore}
                          onClick={() => void loadMore()}
                        >
                          {loadingMore
                            ? t("catalog.loadingMore")
                            : t("catalog.loadMore")}
                        </Button>
                      </div>
                    ) : null}
                  </>
                )}
              </BrowseGridBody>
            </BrowseView>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
