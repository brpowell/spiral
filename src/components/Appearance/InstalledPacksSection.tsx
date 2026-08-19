import { useCallback, useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { RELOAD_LINKED_PACKS_EVENT } from "../../lib/appearanceWindow";
import {
  catalogDisplayName,
  enrichPackCatalog,
  fetchPackCatalogSafe,
  installRegistryPack,
  installRegistryPackVersion,
  versionCmp,
} from "../../lib/packRegistry";
import { prefetchPackReadme } from "../../lib/packs/packReadmeCache";
import {
  createWorkshopPackWithRefresh,
  deleteWorkshopContributionWithRefresh,
  deleteWorkshopPackWithRefresh,
  importPackWithRefresh,
  linkPackFolderWithRefresh,
  reloadLinkedPacksWithRefresh,
  setContributionHiddenWithRefresh,
  uninstallPackWithRefresh,
  unlinkPackWithRefresh,
  updateLinkedPackMetadataWithRefresh,
  updateWorkshopPackMetadataWithRefresh,
} from "../../lib/packs/refreshPackStores";
import { viewTransition } from "../../lib/motion";
import { afterUiTransition } from "../../lib/scheduling";
import { listPacks, openPathInFileManager } from "../../lib/tauri";
import { usePackUpdatesStore } from "../../store/usePackUpdatesStore";
import {
  isAuthoringPackZone,
  packCategoryOf,
  type PackContributionSummary,
  type PackSummary,
} from "../../types/pack";
import type {
  CatalogPackEntry,
  RegistryVersionSummary,
} from "../../types/packRegistry";
import { AlertConfirmation } from "../common/AlertConfirmation/AlertConfirmation";
import { Button } from "../common/Button/Button";
import {
  SectionedList,
  SectionedListGroup,
} from "../common/SectionedList/SectionedList";
import { BrowseGridBody } from "../BrowseView/BrowseGridBody";
import { BrowseView } from "../BrowseView/BrowseView";
import { BrowseViewHeader } from "../BrowseView/BrowseViewHeader";
import {
  ContextMenuItem,
  ContextMenuSeparator,
} from "../ContextMenu/ContextMenu";
import {
  IconDelete,
  IconDownload,
  IconFolderLink,
  IconImport,
  IconPackage,
  IconPackagePlus,
  IconPencil,
  IconRefresh,
  IconUnlink,
} from "../icons";
import { MenuButton } from "../MenuButton/MenuButton";
import { SearchField } from "../SearchField/SearchField";
import { PackListCard } from "./AppearancePackCard";
import { CreatePackModal, type CreatePackModalResult } from "./CreatePackModal";
import { EditPackModal, type EditPackModalResult } from "./EditPackModal";
import { PackDetailView } from "./PackDetailView";
import {
  isPreviousInstalledPack,
  PackPreview,
  packKey,
} from "./packDetailShared";
import "./AppearanceSection.css";
import "./InstalledPacksSection.css";

function matchesPackSearch(pack: PackSummary, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [pack.name, pack.authorId, pack.description, pack.packId]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
}

function InstalledPackCard({
  pack,
  busy,
  updateEntry,
  onSelect,
  onEdit,
  onDelete,
  onUnlink,
  onUpdate,
}: {
  pack: PackSummary;
  busy: boolean;
  updateEntry: CatalogPackEntry | null;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onUnlink: () => void;
  onUpdate: () => void;
}) {
  const { t } = useTranslation(["studio", "common"]);
  const canEdit = isAuthoringPackZone(pack.zone);
  const canUnlink = pack.zone === "linked";
  const canRemove = pack.zone === "workshop" || pack.zone === "installed";
  const canUpdate =
    updateEntry != null &&
    updateEntry.updateAvailable &&
    updateEntry.meetsMinAppVersion;
  const removeLabel =
    pack.zone === "installed"
      ? t("catalog.actionUninstall")
      : t("packs.actionDelete");
  const hasOverflow = canEdit || canUnlink || canRemove;
  const hasActions = hasOverflow || canUpdate;
  const author = pack.authorId.trim() || t("common:unknown");
  const description = pack.description.trim() || undefined;

  return (
    <PackListCard
      name={pack.name}
      author={author}
      description={description}
      ariaLabel={t("packs.cardAria", { name: pack.name, author })}
      preview={
        <PackPreview
          pack={pack}
          className="appearance-pack-card__pack-preview"
        />
      }
      actions={
        hasActions ? (
          <>
            {canUpdate ? (
              <Button
                variant="primary"
                size="xs"
                disabled={busy}
                aria-label={t("packs.cardUpdateAria", { name: pack.name })}
                onClick={(e) => {
                  e.stopPropagation();
                  onUpdate();
                }}
              >
                {t("catalog.statusUpdate")}
              </Button>
            ) : null}
            {hasOverflow ? (
              <MenuButton
                ariaLabel={t("packs.cardActionsAria", { name: pack.name })}
                title={t("packs.cardActionsAria", { name: pack.name })}
                variant="ghost"
                layoutDeps={[busy, canEdit, canUnlink, canRemove, removeLabel]}
              >
                {(close) => (
                  <>
                    {canEdit ? (
                      <ContextMenuItem
                        icon={<IconPencil />}
                        label={t("packs.actionEdit")}
                        disabled={busy}
                        onClick={() => {
                          close();
                          onEdit();
                        }}
                      />
                    ) : null}
                    {canEdit && (canUnlink || canRemove) ? (
                      <ContextMenuSeparator />
                    ) : null}
                    {canUnlink ? (
                      <ContextMenuItem
                        icon={<IconUnlink />}
                        label={t("packs.actionUnlink")}
                        className="context-menu__danger"
                        disabled={busy}
                        onClick={() => {
                          close();
                          onUnlink();
                        }}
                      />
                    ) : null}
                    {canRemove ? (
                      <ContextMenuItem
                        icon={<IconDelete />}
                        label={removeLabel}
                        className="context-menu__danger"
                        disabled={busy}
                        onClick={() => {
                          close();
                          onDelete();
                        }}
                      />
                    ) : null}
                  </>
                )}
              </MenuButton>
            ) : null}
          </>
        ) : undefined
      }
      onOpen={onSelect}
    />
  );
}

export function InstalledPacksSection({
  focusPackId,
  onFocusConsumed,
  onLeaveDetail,
  detailBackAriaLabel,
  selectedKey,
  onSelectedKeyChange,
}: {
  focusPackId?: string | null;
  onFocusConsumed?: () => void;
  onLeaveDetail: () => void;
  detailBackAriaLabel?: string;
  /** Lifted selection so pack detail survives Theme Editor remounts. */
  selectedKey: string | null;
  onSelectedKeyChange: (key: string | null) => void;
}) {
  const { t } = useTranslation(["studio", "common", "library"]);
  const packListBackAriaLabel = detailBackAriaLabel ?? t("backToPacks");
  const [packs, setPacks] = useState<PackSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState("");
  const [importing, setImporting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [uninstallTarget, setUninstallTarget] = useState<PackSummary | null>(
    null,
  );
  const [deleteTarget, setDeleteTarget] = useState<PackSummary | null>(null);
  const [deleteContributionTarget, setDeleteContributionTarget] =
    useState<PackContributionSummary | null>(null);
  const [versionInstallTarget, setVersionInstallTarget] = useState<{
    entry: CatalogPackEntry;
    version: RegistryVersionSummary;
  } | null>(null);
  const [editTarget, setEditTarget] = useState<PackSummary | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [linking, setLinking] = useState(false);
  const [reloading, setReloading] = useState(false);

  const pendingUpdates = usePackUpdatesStore((s) => s.pendingUpdates);
  const packUpdatesStatus = usePackUpdatesStore((s) => s.status);
  const updateAllPendingPacks = usePackUpdatesStore(
    (s) => s.updateAllPendingPacks,
  );
  const pendingUpdateFor = usePackUpdatesStore((s) => s.pendingUpdateFor);
  const checkForPackUpdates = usePackUpdatesStore((s) => s.checkForPackUpdates);

  const reload = useCallback(async () => {
    const next = await listPacks();
    setPacks(next);
    setLoaded(true);
    return next;
  }, []);

  useEffect(() => {
    void reload().catch((err: unknown) => {
      console.error("Failed to load packs:", err);
      setLoaded(true);
    });
  }, [reload]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen(RELOAD_LINKED_PACKS_EVENT, () => {
      void reload().catch((err: unknown) => {
        console.error("Failed to reload pack list after linked reload:", err);
      });
    }).then((fn) => {
      if (disposed) {
        fn();
        return;
      }
      unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [reload]);

  useEffect(() => {
    if (!focusPackId || !loaded) return;
    const match =
      packs.find(
        (p) => p.packId === focusPackId && (p.active || p.zone !== "installed"),
      ) ?? packs.find((p) => p.packId === focusPackId);
    if (match) {
      onSelectedKeyChange(packKey(match));
    }
    onFocusConsumed?.();
  }, [focusPackId, loaded, onFocusConsumed, onSelectedKeyChange, packs]);

  const selected =
    selectedKey != null
      ? (packs.find((p) => packKey(p) === selectedKey) ?? null)
      : null;

  // Inactive previous installs are not list rows; detail redirects to the active sibling.
  useEffect(() => {
    if (!selected || !isPreviousInstalledPack(selected)) return;
    const active = packs.find(
      (p) =>
        p.zone === "installed" &&
        p.authorId === selected.authorId &&
        p.packId === selected.packId &&
        p.active,
    );
    onSelectedKeyChange(active ? packKey(active) : null);
  }, [onSelectedKeyChange, packs, selected]);

  const [catalogEntry, setCatalogEntry] = useState<CatalogPackEntry | null>(
    null,
  );

  useEffect(() => {
    if (!selected || selected.zone !== "installed") {
      setCatalogEntry(null);
      return;
    }
    let cancelled = false;
    const authorId = selected.authorId;
    const packId = selected.packId;
    void (async () => {
      const result = await fetchPackCatalogSafe({ authorId });
      if (cancelled) return;
      if (!result.ok) {
        setCatalogEntry(null);
        return;
      }
      const match = result.catalog.packs.find(
        (p) => p.authorId === authorId && p.packId === packId,
      );
      if (!match) {
        setCatalogEntry(null);
        return;
      }
      const [enriched] = await enrichPackCatalog([match]);
      if (!cancelled) setCatalogEntry(enriched ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const managedPacks = useMemo(
    () =>
      packs.filter(
        (p) =>
          packCategoryOf(p.zone) === "managed" &&
          !isPreviousInstalledPack(p) &&
          matchesPackSearch(p, search),
      ),
    [packs, search],
  );
  const customPacks = useMemo(
    () =>
      packs.filter(
        (p) =>
          packCategoryOf(p.zone) === "custom" && matchesPackSearch(p, search),
      ),
    [packs, search],
  );
  const actionsBusy = importing || linking || reloading || creating;
  const hasSearch = search.trim().length > 0;

  useEffect(() => {
    if (!selected) return;
    void prefetchPackReadme(selected.packDir).catch((err: unknown) => {
      console.error("Failed to prefetch pack README:", err);
    });
  }, [selected]);

  const handleCreatePack = async (result: CreatePackModalResult) => {
    setCreating(true);
    try {
      const packId = await createWorkshopPackWithRefresh(result);
      if (packId) {
        const next = await reload();
        const match = next.find(
          (p) => p.zone === "workshop" && p.packId === packId,
        );
        if (match) {
          onSelectedKeyChange(packKey(match));
        }
        setCreateOpen(false);
      }
    } finally {
      setCreating(false);
    }
  };

  const handleImport = async () => {
    setImporting(true);
    try {
      const result = await importPackWithRefresh();
      if (result) {
        const next = await reload();
        const match = next.find(
          (p) =>
            p.packId === result.packId &&
            p.version === result.version &&
            p.zone === "installed",
        );
        if (match) {
          onSelectedKeyChange(packKey(match));
        }
        void checkForPackUpdates({ reason: "manual" });
      }
    } finally {
      setImporting(false);
    }
  };

  const handleLink = async () => {
    setLinking(true);
    try {
      const path = await linkPackFolderWithRefresh();
      if (path) {
        const next = await reload();
        const match = next.find(
          (p) => p.zone === "linked" && p.packDir === path,
        );
        if (match) {
          onSelectedKeyChange(packKey(match));
        }
      }
    } finally {
      setLinking(false);
    }
  };

  const handleReloadLinked = async () => {
    setReloading(true);
    try {
      await reloadLinkedPacksWithRefresh();
      await reload();
    } finally {
      setReloading(false);
    }
  };

  const handleUninstall = async () => {
    if (!uninstallTarget) return;
    setBusy(true);
    try {
      const ok = await uninstallPackWithRefresh(
        uninstallTarget.authorId,
        uninstallTarget.packId,
        uninstallTarget.version,
        uninstallTarget.name,
      );
      if (ok) {
        onSelectedKeyChange(null);
        await reload();
        void checkForPackUpdates({ reason: "manual" });
      }
    } finally {
      setBusy(false);
      setUninstallTarget(null);
    }
  };

  const handleDeleteWorkshop = async () => {
    if (!deleteTarget || deleteTarget.zone !== "workshop") return;
    setBusy(true);
    try {
      const ok = await deleteWorkshopPackWithRefresh(
        deleteTarget.packId,
        deleteTarget.name,
      );
      if (ok) {
        onSelectedKeyChange(null);
        await reload();
      }
    } finally {
      setBusy(false);
      setDeleteTarget(null);
    }
  };

  const handleUnlink = async (pack: PackSummary) => {
    if (pack.zone !== "linked") return;
    setBusy(true);
    try {
      const ok = await unlinkPackWithRefresh(pack.packDir, pack.name);
      if (ok) {
        onSelectedKeyChange(null);
        await reload();
      }
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteContribution = async () => {
    if (!deleteContributionTarget) return;
    setBusy(true);
    try {
      const result = await deleteWorkshopContributionWithRefresh(
        deleteContributionTarget.effectiveId,
        deleteContributionTarget.name,
      );
      if (result) {
        if (result.packRemoved) onSelectedKeyChange(null);
        await reload();
      }
    } finally {
      setBusy(false);
      setDeleteContributionTarget(null);
    }
  };

  const handleToggleHidden = async (
    contributionId: string,
    hidden: boolean,
  ) => {
    setBusy(true);
    try {
      const ok = await setContributionHiddenWithRefresh(contributionId, hidden);
      if (ok) await reload();
    } finally {
      setBusy(false);
    }
  };

  const handleRegistryUpdate = async (entry?: CatalogPackEntry | null) => {
    const target = entry ?? catalogEntry;
    if (!target?.updateAvailable || !target.meetsMinAppVersion) {
      return;
    }
    setBusy(true);
    try {
      const v = target.latestVersion;
      const result = await installRegistryPack({
        registryUrl: target.registryUrl,
        authorId: target.authorId,
        packId: target.packId,
        version: v.version,
        sha256: v.sha256,
        sizeBytes: v.sizeBytes,
        minAppVersion: v.minAppVersion,
        name: catalogDisplayName(target),
      });
      const next = await reload();
      if (result) {
        const match = next.find(
          (p) =>
            p.zone === "installed" &&
            p.authorId === target.authorId &&
            p.packId === result.packId &&
            p.version === result.version,
        );
        if (match && selectedKey != null) onSelectedKeyChange(packKey(match));
      }
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
      const result = await installRegistryPackVersion({
        registryUrl: entry.registryUrl,
        authorId: entry.authorId,
        packId: entry.packId,
        version,
        installedVersion: entry.installedVersion,
        name: catalogDisplayName(entry),
      });
      const next = await reload();
      if (result) {
        const match = next.find(
          (p) =>
            p.zone === "installed" &&
            p.authorId === entry.authorId &&
            p.packId === entry.packId &&
            p.version === version.version,
        );
        if (match && selectedKey != null) onSelectedKeyChange(packKey(match));
      }
      void checkForPackUpdates({ reason: "manual" });
    } finally {
      setBusy(false);
    }
  };

  const handleInstallVersion = (version: RegistryVersionSummary) => {
    if (!catalogEntry) return;
    const installed = catalogEntry.installedVersion?.trim() || null;
    if (installed) {
      const cmp = versionCmp(version.version, installed);
      if (cmp === 0) return;
      if (cmp === -1) {
        setVersionInstallTarget({ entry: catalogEntry, version });
        return;
      }
    }
    void runInstallVersion(catalogEntry, version);
  };

  const handleConfirmVersionInstall = async () => {
    if (!versionInstallTarget) return;
    const { entry, version } = versionInstallTarget;
    setVersionInstallTarget(null);
    await runInstallVersion(entry, version);
  };

  const handleSaveEdit = async (result: EditPackModalResult) => {
    if (!editTarget || !isAuthoringPackZone(editTarget.zone)) return;
    setSavingEdit(true);
    try {
      const nextPackId =
        editTarget.zone === "linked"
          ? await updateLinkedPackMetadataWithRefresh(
              editTarget.packDir,
              result,
            )
          : await updateWorkshopPackMetadataWithRefresh(
              editTarget.packId,
              result,
            );
      if (nextPackId) {
        const next = await reload();
        const match = next.find(
          (p) =>
            p.zone === editTarget.zone &&
            p.packId === nextPackId &&
            (editTarget.zone === "linked"
              ? p.packDir === editTarget.packDir
              : p.version === result.version),
        );
        if (match && selectedKey != null) {
          onSelectedKeyChange(packKey(match));
        }
        setEditTarget(null);
      }
    } finally {
      setSavingEdit(false);
    }
  };

  const requestDelete = (pack: PackSummary) => {
    if (pack.zone === "workshop") {
      setDeleteTarget(pack);
    } else if (pack.zone === "installed") {
      setUninstallTarget(pack);
    }
  };

  return (
    <div className="installed-packs">
      <AnimatePresence mode="wait">
        {selected && !isPreviousInstalledPack(selected) ? (
          <motion.div
            key={`detail-${selectedKey}`}
            className="installed-packs__detail-wrap"
            {...viewTransition}
          >
            <PackDetailView
              pack={selected}
              catalogEntry={catalogEntry}
              busy={busy || savingEdit || reloading}
              backAriaLabel={packListBackAriaLabel}
              onBack={onLeaveDetail}
              onReveal={() => void openPathInFileManager(selected.packDir)}
              onEdit={() => setEditTarget(selected)}
              onDelete={() => requestDelete(selected)}
              onUnlink={() => void handleUnlink(selected)}
              onToggleHidden={(id, hidden) =>
                void handleToggleHidden(id, hidden)
              }
              onDeleteContribution={setDeleteContributionTarget}
              onUpdate={() => void handleRegistryUpdate()}
              onInstallVersion={catalogEntry ? handleInstallVersion : undefined}
            />
          </motion.div>
        ) : (
          <motion.div
            key="list"
            className="installed-packs__list"
            {...viewTransition}
          >
            <BrowseView>
              <BrowseViewHeader
                className="browse-view__header--single-row"
                title={t("packs.title")}
                count={
                  loaded
                    ? t("library:views.headerCount", { count: packs.length })
                    : undefined
                }
                actions={
                  <div className="installed-packs__header-actions">
                    <SearchField
                      value={search}
                      onChange={setSearch}
                      placeholder={t("packs.searchPlaceholder")}
                      aria-label={t("packs.searchAria")}
                      className="installed-packs__search"
                    />
                    <div className="installed-packs__toolbar-actions">
                      <MenuButton
                        ariaLabel={t("packs.actionsAria")}
                        title={t("common:actions")}
                        layoutDeps={[
                          actionsBusy,
                          importing,
                          linking,
                          reloading,
                        ]}
                      >
                        {(close) => (
                          <>
                            {pendingUpdates.length > 0 ? (
                              <>
                                <ContextMenuItem
                                  icon={<IconDownload />}
                                  label={t("packs.actionUpdateAll")}
                                  disabled={
                                    actionsBusy ||
                                    busy ||
                                    packUpdatesStatus === "updating"
                                  }
                                  onClick={() => {
                                    close();
                                    void (async () => {
                                      await afterUiTransition();
                                      await updateAllPendingPacks();
                                      await reload();
                                    })();
                                  }}
                                />
                                <ContextMenuSeparator />
                              </>
                            ) : null}
                            <ContextMenuItem
                              icon={<IconPackagePlus />}
                              label={t("packs.create")}
                              onClick={() => {
                                close();
                                setCreateOpen(true);
                              }}
                            />
                            <ContextMenuSeparator />
                            <ContextMenuItem
                              icon={<IconImport />}
                              label={
                                importing
                                  ? t("packs.installing")
                                  : t("packs.install")
                              }
                              disabled={actionsBusy}
                              onClick={() => {
                                close();
                                void handleImport();
                              }}
                            />
                            <ContextMenuItem
                              icon={<IconFolderLink />}
                              label={
                                linking
                                  ? t("packs.linking")
                                  : t("packs.linkFolder")
                              }
                              disabled={actionsBusy}
                              onClick={() => {
                                close();
                                void handleLink();
                              }}
                            />
                            <ContextMenuSeparator />
                            <ContextMenuItem
                              icon={<IconRefresh />}
                              label={
                                reloading
                                  ? t("packs.reloading")
                                  : t("packs.reloadLinked")
                              }
                              disabled={actionsBusy}
                              onClick={() => {
                                close();
                                void handleReloadLinked();
                              }}
                            />
                          </>
                        )}
                      </MenuButton>
                    </div>
                  </div>
                }
              />

              <BrowseGridBody>
                {!loaded ? (
                  <p className="browse-view__empty">{t("packs.loading")}</p>
                ) : packs.length === 0 ? (
                  <p className="browse-view__empty">{t("packs.empty")}</p>
                ) : managedPacks.length === 0 && customPacks.length === 0 ? (
                  <p className="browse-view__empty">{t("packs.emptySearch")}</p>
                ) : (
                  <SectionedList className="installed-packs__sectioned-list">
                    {(
                      [
                        {
                          id: "managed",
                          title: t("packs.managed.title"),
                          icon: <IconPackage />,
                          packs: managedPacks,
                          empty: t("packs.managed.empty"),
                          listLabel: t("packs.managed.listLabel"),
                        },
                        {
                          id: "custom",
                          title: t("packs.custom.title"),
                          icon: <IconFolderLink />,
                          packs: customPacks,
                          empty: t("packs.custom.empty"),
                          listLabel: t("packs.custom.listLabel"),
                        },
                      ] as const
                    ).map((category) => {
                      if (hasSearch && category.packs.length === 0) return null;
                      return (
                        <SectionedListGroup
                          key={category.id}
                          title={category.title}
                          icon={category.icon}
                          count={category.packs.length}
                        >
                          {category.packs.length === 0 ? (
                            <p className="appearance-section__status">
                              {category.empty}
                            </p>
                          ) : (
                            <div
                              className="appearance-pack-grid installed-packs__pack-grid"
                              role="list"
                              aria-label={category.listLabel}
                            >
                              {category.packs.map((pack) => {
                                const updateEntry =
                                  pack.zone === "installed"
                                    ? pendingUpdateFor(
                                        pack.authorId,
                                        pack.packId,
                                      )
                                    : null;
                                return (
                                  <div key={packKey(pack)} role="listitem">
                                    <InstalledPackCard
                                      pack={pack}
                                      busy={
                                        busy || packUpdatesStatus === "updating"
                                      }
                                      updateEntry={updateEntry}
                                      onSelect={() =>
                                        onSelectedKeyChange(packKey(pack))
                                      }
                                      onEdit={() => setEditTarget(pack)}
                                      onDelete={() => requestDelete(pack)}
                                      onUnlink={() => void handleUnlink(pack)}
                                      onUpdate={() =>
                                        void handleRegistryUpdate(updateEntry)
                                      }
                                    />
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </SectionedListGroup>
                      );
                    })}
                  </SectionedList>
                )}
              </BrowseGridBody>
            </BrowseView>
          </motion.div>
        )}
      </AnimatePresence>

      <CreatePackModal
        open={createOpen}
        creating={creating}
        onClose={() => setCreateOpen(false)}
        onCreate={(result) => void handleCreatePack(result)}
      />

      <EditPackModal
        open={editTarget != null && isAuthoringPackZone(editTarget.zone)}
        pack={
          editTarget != null && isAuthoringPackZone(editTarget.zone)
            ? editTarget
            : null
        }
        saving={savingEdit}
        onClose={() => setEditTarget(null)}
        onSave={(result) => void handleSaveEdit(result)}
      />

      <AlertConfirmation
        open={uninstallTarget != null}
        onClose={() => setUninstallTarget(null)}
        title={t("catalog.uninstallConfirmTitle")}
        confirmLabel={t("catalog.actionUninstall")}
        onConfirm={handleUninstall}
      >
        {t("catalog.uninstallConfirmBody", {
          name: uninstallTarget?.name ?? "",
        })}
      </AlertConfirmation>

      <AlertConfirmation
        open={deleteTarget != null}
        onClose={() => setDeleteTarget(null)}
        title={t("packs.deleteTitle")}
        confirmLabel={t("common:delete")}
        onConfirm={handleDeleteWorkshop}
      >
        {t("packs.deleteBody", { name: deleteTarget?.name ?? "" })}
      </AlertConfirmation>

      <AlertConfirmation
        open={deleteContributionTarget != null}
        onClose={() => setDeleteContributionTarget(null)}
        title={t("packs.deleteContributionTitle")}
        confirmLabel={t("common:delete")}
        onConfirm={handleDeleteContribution}
      >
        {selected != null &&
        isAuthoringPackZone(selected.zone) &&
        selected.contributions.length <= 1
          ? selected.zone === "linked"
            ? t("packs.deleteContributionLinkedLast", {
                name: deleteContributionTarget?.name ?? "",
                pack: selected.name,
              })
            : t("packs.deleteContributionWorkshopLast", {
                name: deleteContributionTarget?.name ?? "",
                pack: selected.name,
              })
          : t("packs.deleteContribution", {
              name: deleteContributionTarget?.name ?? "",
            })}
      </AlertConfirmation>

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
