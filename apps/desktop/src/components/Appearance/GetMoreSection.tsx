import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { viewTransition } from "../../lib/motion";
import {
  catalogDisplayName,
  catalogPackKey,
  enrichPackCatalog,
  fetchPackCatalogSafe,
  fetchRegistryPackSafe,
  installRegistryPack,
  installRegistryPackVersion,
  versionCmp,
} from "../../lib/packRegistry";
import { prefetchCatalogVersionDocs } from "../../lib/packs/catalogVersionDocsCache";
import { uninstallPackWithRefresh } from "../../lib/packs/refreshPackStores";
import type { ClearableSkinSetting } from "../../lib/packs/packSkinSettings";
import { listPacks, openPathInFileManager } from "../../lib/tauri";
import { usePackUpdatesStore } from "../../store/usePackUpdatesStore";
import type { PackSummary } from "../../types/pack";
import type {
  CatalogPackEntry,
  RegistryVersionSummary,
} from "../../types/packRegistry";
import { BrowseGridBody } from "../BrowseView/BrowseGridBody";
import { BrowseView } from "../BrowseView/BrowseView";
import { BrowseViewHeader } from "../BrowseView/BrowseViewHeader";
import { AlertConfirmation } from "../common/AlertConfirmation/AlertConfirmation";
import { Button } from "../common/Button/Button";
import { EmptyState } from "../common/EmptyState/EmptyState";
import { Skeleton } from "../common/Skeleton/Skeleton";
import { ContextMenuItem } from "../ContextMenu/ContextMenu";
import { IconDelete, IconDisconnected } from "../icons";
import { MenuButton } from "../MenuButton/MenuButton";
import { PackListCard } from "./AppearancePackCard";
import { PackDetailView } from "./PackDetailView";
import { PackPreview } from "./packDetailShared";
import { UninstallPackDialog } from "./UninstallPackDialog";
import "./AppearanceSection.css";
import "./GetMoreSection.css";

type CatalogSnapshot = {
  entries: CatalogPackEntry[];
  partialWarning: boolean;
};

/** Survives Get more remounts when switching Studio sections (stale-while-revalidate). */
let catalogSnapshot: CatalogSnapshot | null = null;

function pickLocalPack(
  packs: PackSummary[],
  entry: CatalogPackEntry,
): PackSummary | null {
  const installed = packs.filter(
    (p) =>
      p.zone === "installed" &&
      p.authorId === entry.authorId &&
      p.packId === entry.packId,
  );
  if (installed.length === 0) return null;
  // Prefer the catalog latest if present; else highest active / first.
  const exact = installed.find(
    (p) => p.version === entry.latestVersion.version,
  );
  if (exact) return exact;
  const active = installed.find((p) => p.active);
  return active ?? installed[0] ?? null;
}

function catalogStatusBadge(
  entry: CatalogPackEntry,
  t: (key: string) => string,
): ReactNode {
  if (!entry.meetsMinAppVersion) {
    return (
      <span className="appearance-pack-card__badge appearance-pack-card__badge--muted">
        {t("catalog.statusRequiresUpdate")}
      </span>
    );
  }
  return null;
}

function CatalogPackCard({
  entry,
  busy,
  onOpen,
  onUpdate,
  onUninstall,
}: {
  entry: CatalogPackEntry;
  busy: boolean;
  onOpen: () => void;
  onUpdate?: () => void;
  onUninstall?: () => void;
}) {
  const { t } = useTranslation(["studio", "common"]);
  const name = catalogDisplayName(entry);
  const author = entry.authorId.trim() || t("common:unknown");
  const description = entry.latestVersion.description?.trim() || undefined;
  const canUninstall = onUninstall != null;
  const canUpdate =
    onUpdate != null && entry.updateAvailable && entry.meetsMinAppVersion;
  const hasActions = canUninstall || canUpdate;

  return (
    <PackListCard
      name={name}
      author={author}
      description={description}
      ariaLabel={t("catalog.cardAria", { name, author })}
      preview={
        <PackPreview
          previewSrc={entry.resolvedPreviewUrl}
          className="appearance-pack-card__pack-preview"
        />
      }
      badge={catalogStatusBadge(entry, t) ?? undefined}
      actions={
        hasActions ? (
          <>
            {canUpdate ? (
              <Button
                variant="primary"
                size="xs"
                disabled={busy}
                aria-label={t("packs.cardUpdateAria", { name })}
                onClick={(e) => {
                  e.stopPropagation();
                  onUpdate();
                }}
              >
                {t("catalog.statusUpdate")}
              </Button>
            ) : null}
            {canUninstall ? (
              <MenuButton
                ariaLabel={t("catalog.cardActionsAria", { name })}
                title={t("catalog.cardActionsAria", { name })}
                variant="ghost"
                layoutDeps={[busy]}
              >
                {(close) => (
                  <ContextMenuItem
                    icon={<IconDelete />}
                    label={t("catalog.actionUninstall")}
                    className="context-menu__danger"
                    disabled={busy}
                    onClick={() => {
                      close();
                      onUninstall();
                    }}
                  />
                )}
              </MenuButton>
            ) : null}
          </>
        ) : undefined
      }
      onOpen={onOpen}
    />
  );
}

/** Warm the registry cache so the detail view opens without a loading state. */
function prefetchEntryDetail(entry: CatalogPackEntry): void {
  void prefetchCatalogVersionDocs({
    registryUrl: entry.registryUrl,
    authorId: entry.authorId,
    packId: entry.packId,
    version: entry.latestVersion.version,
  });
  void fetchRegistryPackSafe({
    registryUrl: entry.registryUrl,
    authorId: entry.authorId,
    packId: entry.packId,
  });
}

function CatalogPackCardSkeleton() {
  return (
    <div className="appearance-pack-card get-more__card-skeleton" aria-hidden>
      <div className="appearance-pack-card__surface">
        <Skeleton
          className="get-more__card-skeleton-preview"
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
        <CatalogPackCardSkeleton key={i} />
      ))}
    </div>
  );
}

export function GetMoreSection() {
  const { t } = useTranslation(["studio", "library"]);
  const [entries, setEntries] = useState<CatalogPackEntry[]>(
    () => catalogSnapshot?.entries ?? [],
  );
  const [localPacks, setLocalPacks] = useState<PackSummary[]>([]);
  const [loading, setLoading] = useState(() => catalogSnapshot == null);
  const [error, setError] = useState<string | null>(null);
  const [partialWarning, setPartialWarning] = useState(
    () => catalogSnapshot?.partialWarning ?? false,
  );
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uninstallTarget, setUninstallTarget] = useState<PackSummary | null>(
    null,
  );
  const [versionInstallTarget, setVersionInstallTarget] = useState<{
    entry: CatalogPackEntry;
    version: RegistryVersionSummary;
  } | null>(null);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  const load = useCallback(async (options?: { force?: boolean }) => {
    const hasData = entriesRef.current.length > 0 || catalogSnapshot != null;
    // Only blank the grid on the first empty load; keep stale data while refetching.
    if (!hasData) {
      setLoading(true);
      setError(null);
      setPartialWarning(false);
    }
    const [result, packs] = await Promise.all([
      fetchPackCatalogSafe({ force: options?.force }),
      listPacks().catch(() => [] as PackSummary[]),
    ]);
    setLocalPacks(packs);
    if (!result.ok) {
      if (!hasData) {
        setEntries([]);
        setError(result.error);
        setLoading(false);
      }
      return;
    }
    const nextPartial = (result.catalog.errors?.length ?? 0) > 0;
    if (!hasData) {
      // First paint: show cards as soon as the catalog lands instead of
      // waiting on every preview download; previews fill in below.
      const quick = await enrichPackCatalog(result.catalog.packs, {
        resolvePreviews: false,
      });
      setEntries(quick);
      setPartialWarning(nextPartial);
      setError(null);
      setLoading(false);
    }
    const enriched = await enrichPackCatalog(result.catalog.packs);
    setEntries(enriched);
    setPartialWarning(nextPartial);
    setError(null);
    catalogSnapshot = {
      entries: enriched,
      partialWarning: nextPartial,
    };
    usePackUpdatesStore.getState().syncPendingFromCatalog(enriched);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedEntry =
    selectedKey == null
      ? null
      : (entries.find(
          (e) =>
            catalogPackKey(e.registryUrl, e.authorId, e.packId) === selectedKey,
        ) ?? null);

  const selectedLocal = selectedEntry
    ? pickLocalPack(localPacks, selectedEntry)
    : null;

  const handleInstallOrUpdate = async (entry: CatalogPackEntry) => {
    if (!entry.meetsMinAppVersion) return;
    if (entry.installed && !entry.updateAvailable) return;
    setBusy(true);
    try {
      const v = entry.latestVersion;
      await installRegistryPack({
        registryUrl: entry.registryUrl,
        authorId: entry.authorId,
        packId: entry.packId,
        version: v.version,
        sha256: v.sha256,
        sizeBytes: v.sizeBytes,
        minAppVersion: v.minAppVersion,
        name: catalogDisplayName(entry),
      });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const runInstallVersion = async (
    entry: CatalogPackEntry,
    version: RegistryVersionSummary,
  ) => {
    setBusy(true);
    try {
      await installRegistryPackVersion({
        registryUrl: entry.registryUrl,
        authorId: entry.authorId,
        packId: entry.packId,
        version,
        installedVersion: entry.installedVersion,
        name: catalogDisplayName(entry),
      });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const handleInstallVersion = (
    entry: CatalogPackEntry,
    version: RegistryVersionSummary,
  ) => {
    const installed = entry.installedVersion?.trim() || null;
    if (installed) {
      const cmp = versionCmp(version.version, installed);
      if (cmp === 0) return;
      if (cmp === -1) {
        setVersionInstallTarget({ entry, version });
        return;
      }
    }
    void runInstallVersion(entry, version);
  };

  const handleConfirmVersionInstall = async () => {
    if (!versionInstallTarget) return;
    const { entry, version } = versionInstallTarget;
    setVersionInstallTarget(null);
    await runInstallVersion(entry, version);
  };

  const requestUninstall = (entry: CatalogPackEntry) => {
    const local = pickLocalPack(localPacks, entry);
    if (!local || local.zone !== "installed") return;
    setUninstallTarget(local);
  };

  const handleUninstall = async (clearSkinSettings: ClearableSkinSetting[]) => {
    if (!uninstallTarget) return;
    setBusy(true);
    try {
      await uninstallPackWithRefresh(
        uninstallTarget.authorId,
        uninstallTarget.packId,
        uninstallTarget.version,
        uninstallTarget.name,
        clearSkinSettings,
      );
      await load();
    } finally {
      setBusy(false);
      setUninstallTarget(null);
    }
  };

  const showSkeleton = loading && entries.length === 0;

  return (
    <div className="get-more">
      <AnimatePresence mode="wait">
        {selectedEntry ? (
          <motion.div
            key={`detail-${selectedKey}`}
            className="get-more__detail-wrap"
            {...viewTransition}
          >
            <PackDetailView
              pack={selectedLocal}
              catalogEntry={selectedEntry}
              busy={busy}
              backAriaLabel={t("backTo", { section: t("catalog.title") })}
              onBack={() => setSelectedKey(null)}
              onInstall={() => void handleInstallOrUpdate(selectedEntry)}
              onUpdate={() => void handleInstallOrUpdate(selectedEntry)}
              onInstallVersion={(version) =>
                handleInstallVersion(selectedEntry, version)
              }
              onDelete={
                selectedLocal?.zone === "installed"
                  ? () => requestUninstall(selectedEntry)
                  : undefined
              }
              onReveal={
                selectedLocal
                  ? () => {
                      void openPathInFileManager(selectedLocal.packDir);
                    }
                  : undefined
              }
            />
          </motion.div>
        ) : (
          <motion.div key="list" className="get-more__list" {...viewTransition}>
            <BrowseView>
              <BrowseViewHeader
                className="browse-view__header--single-row"
                title={t("catalog.title")}
                count={
                  !showSkeleton && !error
                    ? t("library:views.headerCount", { count: entries.length })
                    : undefined
                }
              />
              <BrowseGridBody>
                {partialWarning && !error ? (
                  <p className="get-more__banner appearance-section__status">
                    {t("catalog.partialErrors")}
                  </p>
                ) : null}
                {showSkeleton ? (
                  <CatalogGridSkeleton />
                ) : error && entries.length === 0 ? (
                  <div className="get-more__error" role="alert">
                    <EmptyState
                      icon={<IconDisconnected />}
                      title={t("catalog.unreachableTitle")}
                      description={t("catalog.unreachableDescription")}
                      action={
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => void load({ force: true })}
                        >
                          {t("catalog.retry")}
                        </Button>
                      }
                    />
                  </div>
                ) : entries.length === 0 ? (
                  <p className="browse-view__empty">{t("catalog.empty")}</p>
                ) : (
                  <div className="appearance-pack-grid" role="list">
                    {entries.map((entry) => {
                      const key = catalogPackKey(
                        entry.registryUrl,
                        entry.authorId,
                        entry.packId,
                      );
                      return (
                        <div
                          key={key}
                          role="listitem"
                          onPointerEnter={() => prefetchEntryDetail(entry)}
                          onFocus={() => prefetchEntryDetail(entry)}
                        >
                          <CatalogPackCard
                            entry={entry}
                            busy={busy}
                            onOpen={() => setSelectedKey(key)}
                            onUpdate={
                              entry.updateAvailable && entry.meetsMinAppVersion
                                ? () => void handleInstallOrUpdate(entry)
                                : undefined
                            }
                            onUninstall={
                              entry.installed || entry.updateAvailable
                                ? () => requestUninstall(entry)
                                : undefined
                            }
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
              </BrowseGridBody>
            </BrowseView>
          </motion.div>
        )}
      </AnimatePresence>

      <UninstallPackDialog
        pack={uninstallTarget}
        onClose={() => setUninstallTarget(null)}
        onConfirm={handleUninstall}
      />

      <AlertConfirmation
        open={versionInstallTarget != null}
        onClose={() => setVersionInstallTarget(null)}
        title={t("packs.rollbackConfirmTitle")}
        confirmLabel={t("packs.rollbackConfirmLabel")}
        confirmVariant="primary"
        onConfirm={() => void handleConfirmVersionInstall()}
      >
        {t("packs.rollbackConfirmBody", {
          name: versionInstallTarget
            ? catalogDisplayName(versionInstallTarget.entry)
            : "",
          version: versionInstallTarget?.version.version ?? "",
        })}
      </AlertConfirmation>
    </div>
  );
}
