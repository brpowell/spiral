import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { usePackSizeBytes } from "../../hooks/usePackSizeBytes";
import { revealInFileManagerLabel } from "../../lib/fileManager";
import { formatBytes } from "../../lib/formatBytes";
import {
  catalogDisplayName,
  fetchRegistryPackSafe,
  sortVersionsNewestFirst,
  versionMeetsMinApp,
} from "../../lib/packRegistry";
import { prefetchCatalogVersionDocs } from "../../lib/packs/catalogVersionDocsCache";
import { prefetchPackChangelog } from "../../lib/packs/packChangelogCache";
import { packIdentity } from "../../lib/packs/packManifest";
import { getAppVersion } from "../../lib/tauri";
import {
  isAuthoringPackZone,
  type PackContributionSummary,
  type PackSummary,
} from "../../types/pack";
import type {
  CatalogPackEntry,
  RegistryVersionSummary,
} from "../../types/packRegistry";
import { BrowseGridBody } from "../BrowseView/BrowseGridBody";
import { BrowseView } from "../BrowseView/BrowseView";
import { BrowseViewHeader } from "../BrowseView/BrowseViewHeader";
import { Button } from "../common/Button/Button";
import {
  ButtonGroup,
  ButtonGroupSeparator,
} from "../common/ButtonGroup/ButtonGroup";
import {
  SectionedList,
  SectionedListGroup,
  SectionedListItem,
  SectionedListItemSubtitle,
  SectionedListItemTitle,
  SectionedListItems,
} from "../common/SectionedList/SectionedList";
import { Tab, TabList, TabPanel, Tabs } from "../common/Tabs/Tabs";
import {
  ContextMenuHeading,
  ContextMenuItem,
  ContextMenuOptionItem,
  ContextMenuSeparator,
} from "../ContextMenu/ContextMenu";
import {
  IconChevronDown,
  IconDelete,
  IconHide,
  IconOpenFolder,
  IconPencil,
  IconUnlink,
} from "../icons";
import { MenuButton } from "../MenuButton/MenuButton";
import { useOpenAppearanceThemeEditor } from "./AppearanceThemeEditorContext";
import { PackAboutPanel } from "./PackAboutPanel";
import { PackChangelogPanel } from "./PackChangelogPanel";
import { PackReadmeMarkdown } from "./PackReadmeMarkdown";
import {
  contributionTypeMeta,
  groupContributionsByType,
  PackPreview,
} from "./packDetailShared";
import "./InstalledPacksSection.css";

type PackDetailTab = "about" | "changelog" | "contributions";

function catalogContributions(
  entry: CatalogPackEntry,
): PackContributionSummary[] {
  return (entry.latestVersion.contributions ?? []).map((c) => ({
    type: c.type,
    localId: c.localId,
    effectiveId: c.effectiveId,
    name: c.name,
    author: c.author,
    hidden: false,
  }));
}

/** Catalog About or Changelog body — shares one version-detail fetch via cache. */
function CatalogMarkdownDocPanel({
  entry,
  field,
  loadingKey,
  failedKey,
  emptyKey,
}: {
  entry: CatalogPackEntry;
  field: "readme" | "changelog";
  loadingKey: "catalog.readmeLoading" | "catalog.changelogLoading";
  failedKey: "catalog.readmeLoadFailed" | "catalog.changelogLoadFailed";
  emptyKey: "catalog.readmeEmpty" | "catalog.changelogEmpty";
}) {
  const { t } = useTranslation("studio");
  const [text, setText] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">(
    "loading",
  );

  useEffect(() => {
    let cancelled = false;
    setLoadState("loading");
    setText(null);
    void prefetchCatalogVersionDocs({
      registryUrl: entry.registryUrl,
      authorId: entry.authorId,
      packId: entry.packId,
      version: entry.latestVersion.version,
    }).then((docs) => {
      if (cancelled) return;
      if (docs == null) {
        setLoadState("error");
        return;
      }
      setText(docs[field]);
      setLoadState("ready");
    });
    return () => {
      cancelled = true;
    };
  }, [
    entry.registryUrl,
    entry.authorId,
    entry.packId,
    entry.latestVersion.version,
    field,
  ]);

  if (loadState === "loading") {
    return <p className="appearance-section__status">{t(loadingKey)}</p>;
  }
  if (loadState === "error") {
    return <p className="appearance-section__status">{t(failedKey)}</p>;
  }
  if (text == null) {
    return <p className="appearance-section__status">{t(emptyKey)}</p>;
  }
  return <PackReadmeMarkdown source={text} />;
}

function ContributionActions({
  pack,
  contribution: c,
  busy,
  onToggleHidden,
  onDeleteContribution,
}: {
  pack: PackSummary;
  contribution: PackContributionSummary;
  busy: boolean;
  onToggleHidden?: (contributionId: string, hidden: boolean) => void;
  onDeleteContribution?: (contribution: PackContributionSummary) => void;
}) {
  const openThemeEditor = useOpenAppearanceThemeEditor();
  return (
    <MenuButton
      ariaLabel={`Actions for ${c.name}`}
      title="Actions"
      variant="ghost"
      layoutDeps={[pack.zone, c.type, c.hidden, busy]}
    >
      {(close) => {
        const authoring = isAuthoringPackZone(pack.zone);
        const canEditContribution = authoring && c.type === "theme";
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
                {canEditContribution ? <ContextMenuSeparator /> : null}
                <ContextMenuItem
                  icon={<IconDelete />}
                  label="Delete"
                  className="context-menu__danger"
                  disabled={busy}
                  onClick={() => {
                    close();
                    onDeleteContribution?.(c);
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
                  void onToggleHidden?.(c.effectiveId, !c.hidden);
                }}
              />
            )}
          </>
        );
      }}
    </MenuButton>
  );
}

function ContributionList({
  contributions,
  pack,
  busy,
  onToggleHidden,
  onDeleteContribution,
}: {
  contributions: PackContributionSummary[];
  pack: PackSummary | null;
  busy: boolean;
  onToggleHidden?: (contributionId: string, hidden: boolean) => void;
  onDeleteContribution?: (contribution: PackContributionSummary) => void;
}) {
  const { t } = useTranslation("studio");

  if (contributions.length === 0) {
    return (
      <p className="appearance-section__status">
        {t("catalog.noContributions")}
      </p>
    );
  }

  return (
    <SectionedList>
      {groupContributionsByType(contributions).map(({ type, items }) => {
        const { label, icon } = contributionTypeMeta(type);
        return (
          <SectionedListGroup key={type} title={label} icon={icon}>
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
                    pack == null ? undefined : (
                      <ContributionActions
                        pack={pack}
                        contribution={c}
                        busy={busy}
                        onToggleHidden={onToggleHidden}
                        onDeleteContribution={onDeleteContribution}
                      />
                    )
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
                        <span className="installed-packs__meta-sep" aria-hidden>
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
      })}
    </SectionedList>
  );
}

export type PackDetailViewProps = {
  /** On-disk pack when installed (or workshop/linked from Packs). */
  pack: PackSummary | null;
  /** Catalog row when opened from Get more (or when Update is known). */
  catalogEntry?: CatalogPackEntry | null;
  busy: boolean;
  backAriaLabel: string;
  onBack: () => void;
  onReveal?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onUnlink?: () => void;
  onToggleHidden?: (contributionId: string, hidden: boolean) => void;
  onDeleteContribution?: (contribution: PackContributionSummary) => void;
  onInstall?: () => void;
  onUpdate?: () => void;
  /** Install a specific published registry version (from the split-button menu). */
  onInstallVersion?: (version: RegistryVersionSummary) => void;
};

function PackDetailFacts({
  version,
  sizeBytes,
  fullId,
}: {
  version: string | null;
  sizeBytes: number | null;
  fullId: string | null;
}) {
  const { t } = useTranslation("studio");
  const facts: Array<{
    key: string;
    label: string;
    value: string;
    mono?: boolean;
  }> = [];
  if (version) {
    facts.push({
      key: "version",
      label: t("catalog.detailVersion"),
      value: t("catalog.versionLabel", { version }),
    });
  }
  if (sizeBytes != null && sizeBytes > 0) {
    facts.push({
      key: "size",
      label: t("catalog.detailSize"),
      value: formatBytes(sizeBytes),
    });
  }
  if (fullId) {
    facts.push({
      key: "id",
      label: t("catalog.detailId"),
      value: fullId,
      mono: true,
    });
  }
  if (facts.length === 0) return null;

  return (
    <dl className="installed-packs__facts">
      {facts.map((fact) => (
        <div key={fact.key} className="installed-packs__fact">
          <dt className="installed-packs__fact-label">{fact.label}</dt>
          <dd
            className={[
              "installed-packs__fact-value",
              fact.mono ? "installed-packs__fact-value--id" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            title={fact.mono ? fact.value : undefined}
          >
            {fact.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function PackDetailView({
  pack,
  catalogEntry = null,
  busy,
  backAriaLabel,
  onBack,
  onReveal,
  onEdit,
  onDelete,
  onUnlink,
  onToggleHidden,
  onDeleteContribution,
  onInstall,
  onUpdate,
  onInstallVersion,
}: PackDetailViewProps) {
  const { t } = useTranslation("studio");
  const [tab, setTab] = useState<PackDetailTab>("about");
  const [publishedVersions, setPublishedVersions] = useState<
    RegistryVersionSummary[]
  >([]);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [changelogPresent, setChangelogPresent] = useState(false);

  const canEdit = pack != null && isAuthoringPackZone(pack.zone);
  const canUnlink = pack != null && pack.zone === "linked";
  const canRemove =
    pack != null && (pack.zone === "workshop" || pack.zone === "installed");
  const removeLabel =
    pack?.zone === "installed"
      ? t("catalog.actionUninstall")
      : t("packs.actionDelete");
  const showEdit = canEdit && onEdit != null;
  const showUnlink = canUnlink && onUnlink != null;

  const displayName =
    pack?.name?.trim() ||
    (catalogEntry ? catalogDisplayName(catalogEntry) : "") ||
    pack?.packId ||
    "";
  const authorId = pack?.authorId ?? catalogEntry?.authorId ?? "";
  const packId = pack?.packId ?? catalogEntry?.packId ?? "";
  const version = pack?.version ?? catalogEntry?.latestVersion.version ?? null;
  const sizeBytes = usePackSizeBytes({
    packDir: pack?.packDir,
    catalogSizeBytes: catalogEntry?.latestVersion.sizeBytes,
  });
  const fullId =
    authorId && packId ? packIdentity(authorId, packId) : packId || null;
  const description =
    pack?.description?.trim() ||
    catalogEntry?.latestVersion.description?.trim() ||
    "";
  const contributions =
    pack?.contributions ??
    (catalogEntry ? catalogContributions(catalogEntry) : []);

  /** Not on disk — primary Install. */
  const showInstall =
    catalogEntry != null &&
    !catalogEntry.installed &&
    !catalogEntry.updateAvailable &&
    onInstall != null;
  /** Older install on disk, newer in catalog — primary Update. */
  const showUpdate =
    catalogEntry != null && catalogEntry.updateAvailable && onUpdate != null;
  /** On latest — primary Uninstall (folded into the split; no separate button). */
  const showUninstallPrimary =
    catalogEntry != null &&
    catalogEntry.installed &&
    !catalogEntry.updateAvailable &&
    onDelete != null &&
    pack?.zone === "installed";
  const catalogActionBlocked =
    catalogEntry != null &&
    !catalogEntry.meetsMinAppVersion &&
    (showInstall || showUpdate);
  const showCatalogSplit =
    showInstall || showUpdate || showUninstallPrimary || catalogActionBlocked;
  /** Standalone remove only when not covered by the catalog split. */
  const showRemove =
    canRemove && onDelete != null && !showUninstallPrimary && !showUpdate;

  const installedVersion =
    catalogEntry?.installedVersion ??
    (pack?.zone === "installed" ? pack.version : null);

  // Authoring packs always get the tab (add/edit). Installed/catalog only
  // when CHANGELOG.md / registry detail has content.
  useEffect(() => {
    if (canEdit) {
      setChangelogPresent(true);
      return;
    }

    let cancelled = false;
    setChangelogPresent(false);

    if (pack != null) {
      void prefetchPackChangelog(pack.packDir)
        .then((text) => {
          if (!cancelled) {
            setChangelogPresent(Boolean(text?.trim()));
          }
        })
        .catch(() => {
          if (!cancelled) setChangelogPresent(false);
        });
    } else if (catalogEntry != null) {
      void prefetchCatalogVersionDocs({
        registryUrl: catalogEntry.registryUrl,
        authorId: catalogEntry.authorId,
        packId: catalogEntry.packId,
        version: catalogEntry.latestVersion.version,
      }).then((docs) => {
        if (cancelled) return;
        setChangelogPresent(Boolean(docs?.changelog));
      });
    }

    return () => {
      cancelled = true;
    };
  }, [canEdit, pack, catalogEntry]);

  useEffect(() => {
    if (!changelogPresent && tab === "changelog") {
      setTab("about");
    }
  }, [changelogPresent, tab]);

  useEffect(() => {
    if (!showCatalogSplit || catalogEntry == null || onInstallVersion == null) {
      setPublishedVersions([]);
      return;
    }
    let cancelled = false;
    void fetchRegistryPackSafe({
      registryUrl: catalogEntry.registryUrl,
      authorId: catalogEntry.authorId,
      packId: catalogEntry.packId,
    }).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setPublishedVersions([]);
        return;
      }
      setPublishedVersions(sortVersionsNewestFirst(result.detail.versions));
    });
    return () => {
      cancelled = true;
    };
  }, [showCatalogSplit, onInstallVersion, catalogEntry]);

  useEffect(() => {
    if (!showCatalogSplit) {
      setAppVersion(null);
      return;
    }
    let cancelled = false;
    void getAppVersion().then((v) => {
      if (!cancelled) setAppVersion(v);
    });
    return () => {
      cancelled = true;
    };
  }, [showCatalogSplit]);

  const versionMenuItems = publishedVersions;
  const hasAlternateVersions = versionMenuItems.length > 1;
  /** Update always gets a menu (Uninstall + versions). Others only when there are choices. */
  const showVersionMenu =
    onInstallVersion != null &&
    (showUpdate ||
      ((showInstall || showUninstallPrimary || catalogActionBlocked) &&
        hasAlternateVersions));

  const hasMoreActions = showEdit || showUnlink || onReveal != null;
  const hasHeroActions = showCatalogSplit || showRemove || hasMoreActions;

  const primaryVariant = showUninstallPrimary
    ? "danger"
    : catalogActionBlocked
      ? "secondary"
      : "primary";

  const primaryCatalogAction = (() => {
    if (!showCatalogSplit || catalogEntry == null) return null;
    if (catalogActionBlocked) {
      return (
        <Button variant="secondary" size="sm" disabled>
          {t("catalog.statusRequiresUpdate")}
        </Button>
      );
    }
    if (showInstall) {
      return (
        <Button variant="primary" size="sm" disabled={busy} onClick={onInstall}>
          {t("catalog.actionInstall")}
        </Button>
      );
    }
    if (showUpdate) {
      return (
        <Button variant="primary" size="sm" disabled={busy} onClick={onUpdate}>
          {t("catalog.actionUpdate")}
        </Button>
      );
    }
    if (showUninstallPrimary) {
      return (
        <Button variant="danger" size="sm" disabled={busy} onClick={onDelete}>
          {t("catalog.actionUninstall")}
        </Button>
      );
    }
    return null;
  })();

  const versionMenuContent = (close: () => void) => (
    <>
      {showUpdate && onDelete != null ? (
        <>
          <ContextMenuItem
            className="context-menu__danger"
            icon={<IconDelete />}
            label={t("catalog.actionUninstall")}
            disabled={busy}
            onClick={() => {
              close();
              onDelete();
            }}
          />
          <ContextMenuSeparator />
        </>
      ) : null}
      {versionMenuItems.length > 0 ? (
        <>
          <ContextMenuHeading>
            {t("catalog.menuInstallVersionHeading")}
          </ContextMenuHeading>
          {versionMenuItems.map((versionOption) => {
            const isCurrent =
              installedVersion != null &&
              versionOption.version === installedVersion;
            const meetsMin =
              appVersion == null ||
              versionMeetsMinApp(versionOption.minAppVersion, appVersion);
            return (
              <ContextMenuOptionItem
                key={versionOption.version}
                label={t("catalog.versionLabel", {
                  version: versionOption.version,
                })}
                selected={isCurrent}
                disabled={busy || isCurrent || !meetsMin}
                onClick={() => {
                  close();
                  onInstallVersion?.(versionOption);
                }}
              />
            );
          })}
        </>
      ) : null}
    </>
  );

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
            <PackPreview
              pack={pack}
              previewSrc={catalogEntry?.resolvedPreviewUrl}
              className="installed-packs__preview"
            />
            <div className="installed-packs__hero-main">
              <div className="installed-packs__hero-titles">
                <h3 className="installed-packs__name">{displayName}</h3>
                {description ? (
                  <p className="installed-packs__description">{description}</p>
                ) : null}
                {hasHeroActions ? (
                  <div className="installed-packs__hero-actions">
                    {primaryCatalogAction != null ? (
                      showVersionMenu ? (
                        <ButtonGroup
                          aria-label={t("catalog.menuInstallVersion")}
                        >
                          {primaryCatalogAction}
                          <ButtonGroupSeparator />
                          <MenuButton
                            ariaLabel={t("catalog.menuInstallVersion")}
                            icon={<IconChevronDown />}
                            variant={primaryVariant}
                            size="sm"
                            triggerPlacement="below-start"
                            disabled={busy}
                            layoutDeps={[
                              versionMenuItems.map((v) => v.version).join(","),
                              installedVersion,
                              appVersion,
                              showUpdate,
                              busy,
                            ]}
                          >
                            {versionMenuContent}
                          </MenuButton>
                        </ButtonGroup>
                      ) : (
                        primaryCatalogAction
                      )
                    ) : null}
                    {showRemove ? (
                      <Button
                        variant="danger"
                        size="sm"
                        disabled={busy}
                        onClick={onDelete}
                      >
                        {removeLabel}
                      </Button>
                    ) : null}
                    {hasMoreActions ? (
                      <MenuButton
                        ariaLabel={t("packs.cardActionsAria", {
                          name: displayName,
                        })}
                        title={t("packs.cardActionsAria", {
                          name: displayName,
                        })}
                        variant="secondary"
                        size="sm"
                        triggerPlacement="below-start"
                        disabled={busy}
                        layoutDeps={[
                          showEdit,
                          showUnlink,
                          onReveal != null,
                          busy,
                        ]}
                      >
                        {(close) => (
                          <>
                            {showEdit ? (
                              <ContextMenuItem
                                icon={<IconPencil />}
                                label={t("packs.actionEdit")}
                                disabled={busy}
                                onClick={() => {
                                  close();
                                  onEdit?.();
                                }}
                              />
                            ) : null}
                            {onReveal ? (
                              <ContextMenuItem
                                icon={<IconOpenFolder />}
                                label={revealInFileManagerLabel()}
                                onClick={() => {
                                  close();
                                  onReveal();
                                }}
                              />
                            ) : null}
                            {showUnlink ? (
                              <>
                                {showEdit || onReveal ? (
                                  <ContextMenuSeparator />
                                ) : null}
                                <ContextMenuItem
                                  icon={<IconUnlink />}
                                  label={t("packs.actionUnlink")}
                                  className="context-menu__danger"
                                  disabled={busy}
                                  onClick={() => {
                                    close();
                                    onUnlink?.();
                                  }}
                                />
                              </>
                            ) : null}
                          </>
                        )}
                      </MenuButton>
                    ) : null}
                  </div>
                ) : null}
                <PackDetailFacts
                  version={version}
                  sizeBytes={sizeBytes}
                  fullId={fullId}
                />
              </div>
            </div>
          </header>

          <Tabs
            value={tab}
            onChange={(value) => setTab(value as PackDetailTab)}
            variant="underline"
            className="installed-packs__tabs"
          >
            <TabList aria-label={t("catalog.detailTabsAria")}>
              <Tab value="about">{t("catalog.tabAbout")}</Tab>
              <Tab value="contributions" badge={contributions.length}>
                {t("catalog.tabContributions")}
              </Tab>
              {changelogPresent ? (
                <Tab value="changelog">{t("catalog.tabChangelog")}</Tab>
              ) : null}
            </TabList>
            <TabPanel
              value="about"
              className="installed-packs__tab-panel"
              keepMounted
            >
              {pack ? (
                <PackAboutPanel pack={pack} busy={busy} />
              ) : catalogEntry ? (
                <CatalogMarkdownDocPanel
                  entry={catalogEntry}
                  field="readme"
                  loadingKey="catalog.readmeLoading"
                  failedKey="catalog.readmeLoadFailed"
                  emptyKey="catalog.readmeEmpty"
                />
              ) : (
                <p className="appearance-section__status">
                  {t("catalog.readmeEmpty")}
                </p>
              )}
            </TabPanel>
            {changelogPresent ? (
              <TabPanel
                value="changelog"
                className="installed-packs__tab-panel"
                keepMounted
              >
                {pack ? (
                  <PackChangelogPanel
                    pack={pack}
                    busy={busy}
                    onPresenceChange={canEdit ? undefined : setChangelogPresent}
                  />
                ) : catalogEntry ? (
                  <CatalogMarkdownDocPanel
                    entry={catalogEntry}
                    field="changelog"
                    loadingKey="catalog.changelogLoading"
                    failedKey="catalog.changelogLoadFailed"
                    emptyKey="catalog.changelogEmpty"
                  />
                ) : (
                  <p className="appearance-section__status">
                    {t("catalog.changelogEmpty")}
                  </p>
                )}
              </TabPanel>
            ) : null}
            <TabPanel
              value="contributions"
              className="installed-packs__tab-panel"
            >
              <ContributionList
                contributions={contributions}
                pack={pack}
                busy={busy}
                onToggleHidden={onToggleHidden}
                onDeleteContribution={onDeleteContribution}
              />
            </TabPanel>
          </Tabs>
        </div>
      </BrowseGridBody>
    </BrowseView>
  );
}
