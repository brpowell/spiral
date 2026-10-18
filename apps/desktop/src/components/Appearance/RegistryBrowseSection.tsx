import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { viewTransition } from "../../lib/motion";
import {
  catalogCacheKey,
  catalogItemKey,
  enrichItemCatalog,
  fetchItemCatalogSafe,
  installRegistryItem,
  prefetchItemDetail,
} from "../../lib/itemRegistry";
import { useItemsVersionStore } from "../../store/useItemsVersionStore";
import { ITEM_TYPES, type ItemType } from "../../types/item";
import {
  catalogItemName,
  type CatalogItemEntry,
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
import { Tab, TabList, Tabs } from "../common/Tabs/Tabs";
import { IconDisconnected, IconSearch } from "../icons";
import { itemTypeMeta } from "./itemShared";
import { RegistryItemCard } from "./RegistryItemCard";
import { RegistryItemDetailView } from "./RegistryItemDetailView";
import "./AppearanceSection.css";
import "./RegistryBrowse.css";

/** Items per catalog request; "Load more" fetches the next page. */
export const CATALOG_PAGE_SIZE = 48;
const SEARCH_DEBOUNCE_MS = 300;

type TypeFilter = ItemType | "all";

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

function snapshotKey(filter: TypeFilter, q: string): string {
  return catalogCacheKey({
    itemType: filter === "all" ? null : filter,
    q,
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
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [searchText, setSearchText] = useState("");
  const [query, setQuery] = useState("");
  const [entries, setEntries] = useState<CatalogItemEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [partialWarning, setPartialWarning] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
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
      const itemType = typeFilter === "all" ? null : typeFilter;
      const snapshot = snapshots.get(snapshotKey(typeFilter, query));

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
        itemType,
        q: query,
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
      snapshots.set(snapshotKey(typeFilter, query), {
        entries: full,
        total: result.catalog.total,
        partialWarning: partial,
      });
    },
    [typeFilter, query],
  );

  useEffect(() => {
    setSelectedKey(null);
    void loadFirstPage();
  }, [loadFirstPage]);

  const loadMore = useCallback(async () => {
    setLoadingMore(true);
    const requestId = requestRef.current;
    try {
      const result = await fetchItemCatalogSafe({
        itemType: typeFilter === "all" ? null : typeFilter,
        q: query,
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
  }, [typeFilter, query]);

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
      const target = version ?? entry.latestVersion;
      if (version == null && !entry.meetsMinAppVersion) return;
      setBusy(true);
      try {
        await installRegistryItem({
          registryUrl: entry.registryUrl,
          publisherId: entry.publisherId,
          itemType: entry.itemType,
          id: entry.id,
          version: target.version,
          sha256: target.sha256,
          sizeBytes: target.sizeBytes,
          minAppVersion: target.minAppVersion,
          name: catalogItemName(entry),
        });
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const showSkeleton = loading && entries.length === 0;
  const hasMore = entries.length < total;
  const filtered = typeFilter !== "all" || query !== "";

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
                <Tabs
                  value={typeFilter}
                  onChange={(value) => setTypeFilter(value as TypeFilter)}
                  variant="underline"
                  className="registry-browse__types"
                >
                  <TabList aria-label={t("catalog.typeFilterAria")}>
                    <Tab value="all">{t("catalog.typeAll")}</Tab>
                    {ITEM_TYPES.map((type) => (
                      <Tab key={type} value={type}>
                        {t(`catalog.typePlural.${type}`, {
                          defaultValue: itemTypeMeta(type).label,
                        })}
                      </Tab>
                    ))}
                  </TabList>
                </Tabs>
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
              </div>
              <BrowseGridBody>
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
