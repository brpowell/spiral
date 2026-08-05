import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { listen } from "@tauri-apps/api/event";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { RELOAD_LINKED_PACKS_EVENT } from "../../lib/appearanceWindow";
import { revealInFileManagerLabel } from "../../lib/fileManager";
import { packIconUrl } from "../../lib/packs/packIcon";
import { prefetchPackReadme } from "../../lib/packs/packReadmeCache";
import {
  createWorkshopPackWithRefresh,
  deleteWorkshopContributionWithRefresh,
  deleteWorkshopPackWithRefresh,
  importPackWithRefresh,
  linkPackFolderWithRefresh,
  reloadLinkedPacksWithRefresh,
  rollbackPackWithRefresh,
  setContributionHiddenWithRefresh,
  uninstallPackWithRefresh,
  unlinkPackWithRefresh,
  updateLinkedPackMetadataWithRefresh,
  updateWorkshopPackMetadataWithRefresh,
} from "../../lib/packs/refreshPackStores";
import { viewTransition } from "../../lib/motion";
import { listPacks, openPathInFileManager } from "../../lib/tauri";
import {
  isAuthoringPackZone,
  packCategoryOf,
  CONTRIBUTION_TYPE_FOLDERS,
  type PackContributionSummary,
  type PackSummary,
} from "../../types/pack";
import { AlertConfirmation } from "../common/AlertConfirmation/AlertConfirmation";
import {
  SectionedList,
  SectionedListGroup,
  SectionedListItem,
  SectionedListItemSubtitle,
  SectionedListItemTitle,
  SectionedListItems,
} from "../common/SectionedList/SectionedList";
import { Tab, TabList, TabPanel, Tabs } from "../common/Tabs/Tabs";
import { BrowseGridBody } from "../BrowseView/BrowseGridBody";
import { BrowseView } from "../BrowseView/BrowseView";
import { BrowseViewHeader } from "../BrowseView/BrowseViewHeader";
import {
  ContextMenuItem,
  ContextMenuSeparator,
} from "../ContextMenu/ContextMenu";
import {
  IconDelete,
  IconFolderLink,
  IconGpu,
  IconHide,
  IconImport,
  IconLink,
  IconOpenFolder,
  IconPackage,
  IconPackagePlus,
  IconPalette,
  IconPencil,
  IconRefresh,
  IconSkinMode,
  IconUnlink,
  IconVisualizer,
} from "../icons";
import { MenuButton } from "../MenuButton/MenuButton";
import { SearchField } from "../SearchField/SearchField";
import { useOpenAppearanceThemeEditor } from "./AppearanceThemeEditorContext";
import { CreatePackModal, type CreatePackModalResult } from "./CreatePackModal";
import { EditPackModal, type EditPackModalResult } from "./EditPackModal";
import { PackAboutPanel } from "./PackAboutPanel";
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

function contributionTypeMeta(type: string): {
  label: string;
  icon: ReactNode;
} {
  switch (type) {
    case "theme":
      return { label: "Themes", icon: <IconPalette /> };
    case "skin":
      return { label: "Skins", icon: <IconSkinMode /> };
    case "visualizer":
      return { label: "Visualizers", icon: <IconVisualizer /> };
    case "renderer":
      return { label: "Renderers", icon: <IconGpu /> };
    default:
      return { label: type, icon: <IconPackage /> };
  }
}

/** Group contributions by type in canonical folder order, then any unknown types. */
function groupContributionsByType(
  contributions: PackContributionSummary[],
): Array<{ type: string; items: PackContributionSummary[] }> {
  const byType = new Map<string, PackContributionSummary[]>();
  for (const c of contributions) {
    const list = byType.get(c.type);
    if (list) {
      list.push(c);
    } else {
      byType.set(c.type, [c]);
    }
  }

  const groups: Array<{ type: string; items: PackContributionSummary[] }> = [];
  for (const { type } of CONTRIBUTION_TYPE_FOLDERS) {
    const items = byType.get(type);
    if (items?.length) {
      groups.push({ type, items });
      byType.delete(type);
    }
  }
  for (const [type, items] of byType) {
    groups.push({ type, items });
  }
  return groups;
}

function packKey(pack: PackSummary): string {
  return `${pack.zone}:${pack.packId}@${pack.version}:${pack.packDir}`;
}

function PackIcon({
  pack,
  className,
}: {
  pack: PackSummary;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const src =
    pack.icon && !failed ? packIconUrl(pack.packDir, pack.icon) : null;

  return (
    <div className={className} aria-hidden>
      {src ? (
        <img
          className="installed-packs__icon-img"
          src={src}
          alt=""
          onError={() => setFailed(true)}
        />
      ) : (
        <IconPackage />
      )}
    </div>
  );
}

/** Author • version • linked status (when relevant). */
function PackMetaLine({
  pack,
  className,
}: {
  pack: PackSummary;
  className?: string;
}) {
  const author = pack.authorId.trim();
  const parts: Array<{ key: string; node: ReactNode }> = [];
  if (author) {
    parts.push({ key: "author", node: author });
  }
  parts.push({ key: "version", node: `v${pack.version}` });
  if (!pack.active && pack.zone === "installed") {
    parts.push({ key: "previous", node: "previous" });
  }
  if (pack.zone === "linked") {
    parts.push({
      key: "linked",
      node: (
        <span className="installed-packs__linked-status">
          <IconLink aria-hidden />
          Linked
        </span>
      ),
    });
  }

  return (
    <span
      className={["installed-packs__meta", className].filter(Boolean).join(" ")}
    >
      {parts.map((part, index) => (
        <span key={part.key} className="installed-packs__meta-part">
          {index > 0 ? (
            <span className="installed-packs__meta-sep" aria-hidden>
              •
            </span>
          ) : null}
          {part.node}
        </span>
      ))}
    </span>
  );
}

function PackListRow({
  pack,
  busy,
  onSelect,
  onEdit,
  onDelete,
  onUnlink,
}: {
  pack: PackSummary;
  busy: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onUnlink: () => void;
}) {
  const canEdit = isAuthoringPackZone(pack.zone);
  const canUnlink = pack.zone === "linked";
  const canRemove = pack.zone === "workshop" || pack.zone === "installed";
  const removeLabel = pack.zone === "installed" ? "Uninstall" : "Delete";
  const hasActions = canEdit || canUnlink || canRemove;
  const description = pack.description.trim();

  return (
    <SectionedListItem
      leading={<PackIcon pack={pack} className="installed-packs__row-icon" />}
      onSelect={onSelect}
      aria-label={pack.name}
      actions={
        hasActions ? (
          <MenuButton
            ariaLabel={`Actions for ${pack.name}`}
            title="Actions"
            variant="ghost"
            layoutDeps={[busy, canEdit, canUnlink, canRemove, removeLabel]}
          >
            {(close) => (
              <>
                {canEdit ? (
                  <ContextMenuItem
                    icon={<IconPencil />}
                    label="Edit"
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
                    label="Unlink"
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
        ) : null
      }
    >
      <SectionedListItemTitle>{pack.name}</SectionedListItemTitle>
      {description ? (
        <span className="installed-packs__row-description">{description}</span>
      ) : null}
      <PackMetaLine pack={pack} className="sectioned-list__item-subtitle" />
    </SectionedListItem>
  );
}

type PackDetailTab = "about" | "contributions";

function PackDetailView({
  pack,
  busy,
  backAriaLabel,
  onBack,
  onReveal,
  onEdit,
  onDelete,
  onUnlink,
  onRollback,
  onToggleHidden,
  onDeleteContribution,
}: {
  pack: PackSummary;
  busy: boolean;
  backAriaLabel: string;
  onBack: () => void;
  onReveal: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onUnlink: () => void;
  onRollback: () => void;
  onToggleHidden: (contributionId: string, hidden: boolean) => void;
  onDeleteContribution: (contribution: PackContributionSummary) => void;
}) {
  const [tab, setTab] = useState<PackDetailTab>("about");
  const openThemeEditor = useOpenAppearanceThemeEditor();
  const canEdit = isAuthoringPackZone(pack.zone);
  const canUnlink = pack.zone === "linked";
  const canRemove = pack.zone === "workshop" || pack.zone === "installed";
  const removeLabel = pack.zone === "installed" ? "Uninstall" : "Delete";

  return (
    <BrowseView>
      <BrowseViewHeader
        className="browse-view__header--single-row"
        title="Pack Details"
        backAriaLabel={backAriaLabel}
        onBack={onBack}
      />
      <BrowseGridBody>
        <div className="installed-packs__detail-body">
          <header className="installed-packs__hero">
            <PackIcon pack={pack} className="installed-packs__icon" />
            <div className="installed-packs__hero-main">
              <div className="installed-packs__hero-top">
                <div className="installed-packs__hero-titles">
                  <div className="installed-packs__name-row">
                    <h3 className="installed-packs__name">{pack.name}</h3>
                    <code
                      className="installed-packs__code-badge"
                      title="Pack ID"
                    >
                      {pack.packId}
                    </code>
                  </div>
                  {pack.description ? (
                    <p className="installed-packs__description">
                      {pack.description}
                    </p>
                  ) : null}
                  <PackMetaLine pack={pack} />
                </div>
                <MenuButton
                  ariaLabel={`Actions for ${pack.name}`}
                  title="Actions"
                  layoutDeps={[
                    pack.rollbackVersion,
                    pack.zone,
                    busy,
                    canEdit,
                    canUnlink,
                    canRemove,
                    removeLabel,
                  ]}
                >
                  {(close) => (
                    <>
                      {canEdit ? (
                        <ContextMenuItem
                          icon={<IconPencil />}
                          label="Edit"
                          disabled={busy}
                          onClick={() => {
                            close();
                            onEdit();
                          }}
                        />
                      ) : null}
                      <ContextMenuItem
                        icon={<IconOpenFolder />}
                        label={revealInFileManagerLabel()}
                        onClick={() => {
                          close();
                          onReveal();
                        }}
                      />
                      {pack.rollbackVersion ? (
                        <ContextMenuItem
                          label={`Roll back to ${pack.rollbackVersion}`}
                          disabled={busy}
                          onClick={() => {
                            close();
                            onRollback();
                          }}
                        />
                      ) : null}
                      {canUnlink ? (
                        <>
                          <ContextMenuSeparator />
                          <ContextMenuItem
                            icon={<IconUnlink />}
                            label="Unlink"
                            className="context-menu__danger"
                            disabled={busy}
                            onClick={() => {
                              close();
                              onUnlink();
                            }}
                          />
                        </>
                      ) : null}
                      {canRemove ? (
                        <>
                          <ContextMenuSeparator />
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
                        </>
                      ) : null}
                    </>
                  )}
                </MenuButton>
              </div>
            </div>
          </header>

          <Tabs
            value={tab}
            onChange={(value) => setTab(value as PackDetailTab)}
            variant="underline"
            className="installed-packs__tabs"
          >
            <TabList aria-label="Pack detail sections">
              <Tab value="about">About</Tab>
              <Tab value="contributions" badge={pack.contributions.length}>
                Contributions
              </Tab>
            </TabList>
            <TabPanel
              value="about"
              className="installed-packs__tab-panel"
              keepMounted
            >
              <PackAboutPanel pack={pack} busy={busy} />
            </TabPanel>
            <TabPanel
              value="contributions"
              className="installed-packs__tab-panel"
            >
              {pack.contributions.length === 0 ? (
                <p className="appearance-section__status">No contributions.</p>
              ) : (
                <SectionedList>
                  {groupContributionsByType(pack.contributions).map(
                    ({ type, items }) => {
                      const { label, icon } = contributionTypeMeta(type);
                      return (
                        <SectionedListGroup
                          key={type}
                          title={label}
                          icon={icon}
                        >
                          <SectionedListItems>
                            {items.map((c) => (
                              <SectionedListItem
                                key={c.effectiveId}
                                className={
                                  c.hidden
                                    ? "installed-packs__contribution--hidden"
                                    : undefined
                                }
                                actions={
                                  <MenuButton
                                    ariaLabel={`Actions for ${c.name}`}
                                    title="Actions"
                                    variant="ghost"
                                    layoutDeps={[
                                      pack.zone,
                                      c.type,
                                      c.hidden,
                                      busy,
                                    ]}
                                  >
                                    {(close) => {
                                      const authoring = isAuthoringPackZone(
                                        pack.zone,
                                      );
                                      const canEditContribution =
                                        authoring && c.type === "theme";
                                      return (
                                        <>
                                          {canEditContribution ? (
                                            <ContextMenuItem
                                              icon={<IconPencil />}
                                              label="Edit"
                                              disabled={busy}
                                              onClick={() => {
                                                close();
                                                openThemeEditor(c.effectiveId);
                                              }}
                                            />
                                          ) : null}
                                          {authoring ? (
                                            <>
                                              {canEditContribution ? (
                                                <ContextMenuSeparator />
                                              ) : null}
                                              <ContextMenuItem
                                                icon={<IconDelete />}
                                                label="Delete"
                                                className="context-menu__danger"
                                                disabled={busy}
                                                onClick={() => {
                                                  close();
                                                  onDeleteContribution(c);
                                                }}
                                              />
                                            </>
                                          ) : (
                                            <ContextMenuItem
                                              icon={<IconHide />}
                                              label={c.hidden ? "Show" : "Hide"}
                                              disabled={busy}
                                              onClick={() => {
                                                close();
                                                void onToggleHidden(
                                                  c.effectiveId,
                                                  !c.hidden,
                                                );
                                              }}
                                            />
                                          )}
                                        </>
                                      );
                                    }}
                                  </MenuButton>
                                }
                              >
                                <SectionedListItemTitle>
                                  {c.name}
                                  {c.hidden ? (
                                    <span
                                      className="installed-packs__hidden-icon"
                                      title="Hidden"
                                      aria-label="Hidden"
                                    >
                                      <IconHide />
                                    </span>
                                  ) : null}
                                </SectionedListItemTitle>
                                <SectionedListItemSubtitle>
                                  {c.author.trim() ? (
                                    <span className="installed-packs__meta-part">
                                      {c.author}
                                    </span>
                                  ) : null}
                                  <span className="installed-packs__meta-part">
                                    {c.author.trim() ? (
                                      <span
                                        className="installed-packs__meta-sep"
                                        aria-hidden
                                      >
                                        •
                                      </span>
                                    ) : null}
                                    <code
                                      className="installed-packs__code-badge"
                                      title="Contribution ID"
                                    >
                                      {c.effectiveId}
                                    </code>
                                  </span>
                                </SectionedListItemSubtitle>
                              </SectionedListItem>
                            ))}
                          </SectionedListItems>
                        </SectionedListGroup>
                      );
                    },
                  )}
                </SectionedList>
              )}
            </TabPanel>
          </Tabs>
        </div>
      </BrowseGridBody>
    </BrowseView>
  );
}

export function InstalledPacksSection({
  focusPackId,
  onFocusConsumed,
  onLeaveDetail,
  detailBackAriaLabel = "Back to Packs",
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
  const { t } = useTranslation("studio");
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
  const [rollbackTarget, setRollbackTarget] = useState<PackSummary | null>(
    null,
  );
  const [editTarget, setEditTarget] = useState<PackSummary | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [linking, setLinking] = useState(false);
  const [reloading, setReloading] = useState(false);

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

  const managedPacks = useMemo(
    () =>
      packs.filter(
        (p) =>
          packCategoryOf(p.zone) === "managed" && matchesPackSearch(p, search),
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
        uninstallTarget.packId,
        uninstallTarget.version,
        uninstallTarget.name,
      );
      if (ok) {
        onSelectedKeyChange(null);
        await reload();
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

  const handleRollback = async () => {
    if (!rollbackTarget?.rollbackVersion) return;
    setBusy(true);
    try {
      const ok = await rollbackPackWithRefresh(
        rollbackTarget.packId,
        rollbackTarget.rollbackVersion,
        rollbackTarget.name,
      );
      if (ok) {
        const next = await reload();
        const match = next.find(
          (p) =>
            p.packId === rollbackTarget.packId &&
            p.version === rollbackTarget.rollbackVersion &&
            p.zone === "installed",
        );
        if (match) {
          onSelectedKeyChange(packKey(match));
        } else {
          onSelectedKeyChange(null);
        }
      }
    } finally {
      setBusy(false);
      setRollbackTarget(null);
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
        {selected ? (
          <motion.div
            key={`detail-${selectedKey}`}
            className="installed-packs__detail-wrap"
            {...viewTransition}
          >
            <PackDetailView
              pack={selected}
              busy={busy || savingEdit || reloading}
              backAriaLabel={detailBackAriaLabel}
              onBack={onLeaveDetail}
              onReveal={() => void openPathInFileManager(selected.packDir)}
              onEdit={() => setEditTarget(selected)}
              onDelete={() => requestDelete(selected)}
              onUnlink={() => void handleUnlink(selected)}
              onRollback={() => setRollbackTarget(selected)}
              onToggleHidden={(id, hidden) =>
                void handleToggleHidden(id, hidden)
              }
              onDeleteContribution={setDeleteContributionTarget}
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
                title="Packs"
                count={loaded ? `(${packs.length})` : undefined}
                actions={
                  <div className="installed-packs__header-actions">
                    <SearchField
                      value={search}
                      onChange={setSearch}
                      placeholder="Search packs…"
                      aria-label="Search packs"
                      className="installed-packs__search"
                    />
                    <div className="installed-packs__toolbar-actions">
                      <MenuButton
                        ariaLabel="Pack actions"
                        title="Actions"
                        layoutDeps={[
                          actionsBusy,
                          importing,
                          linking,
                          reloading,
                        ]}
                      >
                        {(close) => (
                          <>
                            <ContextMenuItem
                              icon={<IconPackagePlus />}
                              label="Create Pack…"
                              onClick={() => {
                                close();
                                setCreateOpen(true);
                              }}
                            />
                            <ContextMenuSeparator />
                            <ContextMenuItem
                              icon={<IconImport />}
                              label={
                                importing ? "Installing…" : "Install Pack…"
                              }
                              disabled={actionsBusy}
                              onClick={() => {
                                close();
                                void handleImport();
                              }}
                            />
                            <ContextMenuItem
                              icon={<IconFolderLink />}
                              label={linking ? "Linking…" : "Link a Folder…"}
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
                                reloading ? "Reloading…" : "Reload Linked Packs"
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
                  <p className="browse-view__empty">Loading packs…</p>
                ) : packs.length === 0 ? (
                  <p className="browse-view__empty">No packs found.</p>
                ) : managedPacks.length === 0 && customPacks.length === 0 ? (
                  <p className="browse-view__empty">
                    No packs match your search.
                  </p>
                ) : (
                  <SectionedList className="installed-packs__sectioned-list">
                    {(
                      [
                        {
                          id: "managed",
                          title: "Managed",
                          icon: <IconPackage />,
                          packs: managedPacks,
                          empty: t("packs.managed.empty"),
                          listLabel: t("packs.managed.listLabel"),
                        },
                        {
                          id: "custom",
                          title: "Custom",
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
                            <SectionedListItems aria-label={category.listLabel}>
                              {category.packs.map((pack) => (
                                <PackListRow
                                  key={packKey(pack)}
                                  pack={pack}
                                  busy={busy}
                                  onSelect={() =>
                                    onSelectedKeyChange(packKey(pack))
                                  }
                                  onEdit={() => setEditTarget(pack)}
                                  onDelete={() => requestDelete(pack)}
                                  onUnlink={() => void handleUnlink(pack)}
                                />
                              ))}
                            </SectionedListItems>
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
        title="Uninstall pack?"
        confirmLabel="Uninstall"
        onConfirm={handleUninstall}
      >
        This removes {uninstallTarget?.name} v{uninstallTarget?.version} and all
        of its contributions from Studio pickers. The pack directory is deleted.
      </AlertConfirmation>

      <AlertConfirmation
        open={deleteTarget != null}
        onClose={() => setDeleteTarget(null)}
        title="Delete pack?"
        confirmLabel="Delete"
        onConfirm={handleDeleteWorkshop}
      >
        This permanently deletes the workshop pack “{deleteTarget?.name}” and
        all of its contributions. This cannot be undone.
      </AlertConfirmation>

      <AlertConfirmation
        open={deleteContributionTarget != null}
        onClose={() => setDeleteContributionTarget(null)}
        title="Delete contribution?"
        confirmLabel="Delete"
        onConfirm={handleDeleteContribution}
      >
        {selected != null &&
        isAuthoringPackZone(selected.zone) &&
        selected.contributions.length <= 1
          ? selected.zone === "linked"
            ? `This removes “${deleteContributionTarget?.name}” from the linked pack “${selected.name}”. The folder on disk is left in place. This cannot be undone.`
            : `This removes “${deleteContributionTarget?.name}” and deletes the workshop pack “${selected.name}” because it has no other contributions. This cannot be undone.`
          : `This removes “${deleteContributionTarget?.name}” from the pack. This cannot be undone.`}
      </AlertConfirmation>

      <AlertConfirmation
        open={rollbackTarget != null}
        onClose={() => setRollbackTarget(null)}
        title="Roll back pack?"
        confirmLabel="Roll back"
        confirmVariant="primary"
        onConfirm={handleRollback}
      >
        Remove newer versions of {rollbackTarget?.name} and keep v
        {rollbackTarget?.rollbackVersion} as the installed version.
      </AlertConfirmation>
    </div>
  );
}
