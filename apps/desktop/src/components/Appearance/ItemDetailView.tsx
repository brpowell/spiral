import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { usePackSizeBytes } from "../../hooks/usePackSizeBytes";
import { revealInFileManagerLabel } from "../../lib/fileManager";
import { formatBytes } from "../../lib/formatBytes";
import { RELOAD_LINKED_PACKS_EVENT } from "../../lib/appearanceWindow";
import { prefetchPackChangelog } from "../../lib/packs/packChangelogCache";
import {
  listItems,
  openPathInFileManager,
  readItemManifestJson,
} from "../../lib/tauri";
import { WORKSHOP_CHANGED_EVENT } from "../../lib/themeBridge";
import { updateItemMetadataWithRefresh } from "../../lib/items/itemActions";
import { useItemsVersionStore } from "../../store/useItemsVersionStore";
import { isEditableItem, type ItemSummary } from "../../types/item";
import type { ThemeTokens } from "../../types/theme";
import { BrowseGridBody } from "../BrowseView/BrowseGridBody";
import { BrowseView } from "../BrowseView/BrowseView";
import { BrowseViewHeader } from "../BrowseView/BrowseViewHeader";
import { Button } from "../common/Button/Button";
import { IconPencil, IconUnlink } from "../icons";
import { Tab, TabList, TabPanel, Tabs } from "../common/Tabs/Tabs";
import { useOpenAppearanceThemeEditor } from "./AppearanceThemeEditorContext";
import { EditItemModal, type EditItemModalResult } from "./EditItemModal";
import { InstalledItemActions } from "./InstalledItemActions";
import { ItemActionsMenu } from "./ItemActionsMenu";
import { UnlinkItemDialog } from "./UnlinkItemDialog";
import { ItemAboutPanel } from "./ItemAboutPanel";
import { ItemChangelogPanel } from "./ItemChangelogPanel";
import { ItemContentsPanel } from "./ItemContentsPanel";
import { itemTypeMeta, ItemPreview } from "./itemShared";
import { ThemeSwatchPreview } from "./ThemeSwatchPreview";
import "./InstalledPacksSection.css";

type ItemDetailTab = "about" | "contents" | "changelog";

/** Active on-disk record for `effectiveId` (workshop/linked win over installed/builtin). */
function pickItem(
  items: ItemSummary[],
  effectiveId: string,
): ItemSummary | null {
  return (
    items.find((i) => i.effectiveId === effectiveId && i.active) ??
    items.find((i) => i.effectiveId === effectiveId) ??
    null
  );
}

/** Hero preview for a theme: its color bands, read from the manifest. */
function ThemeHeroPreview({
  item,
  reloadKey,
}: {
  item: ItemSummary;
  reloadKey: unknown;
}) {
  const [tokens, setTokens] = useState<ThemeTokens | null>(null);

  useEffect(() => {
    let cancelled = false;
    void readItemManifestJson(item.dir)
      .then((manifest) => {
        if (cancelled) return;
        const raw = manifest.tokens;
        setTokens(
          raw != null && typeof raw === "object" && !Array.isArray(raw)
            ? (raw as ThemeTokens)
            : {},
        );
      })
      .catch(() => {
        if (!cancelled) setTokens(null);
      });
    return () => {
      cancelled = true;
    };
  }, [item.dir, reloadKey]);

  if (tokens == null) {
    return <ItemPreview item={item} className="installed-packs__preview" />;
  }
  return (
    <div className="installed-packs__preview" aria-hidden>
      <ThemeSwatchPreview theme={{ tokens }} />
    </div>
  );
}

function ItemFacts({
  item,
  sizeBytes,
}: {
  item: ItemSummary;
  sizeBytes: number | null;
}) {
  const { t } = useTranslation("studio");
  const facts: Array<{
    key: string;
    label: string;
    value: string;
    mono?: boolean;
  }> = [
    {
      key: "type",
      label: t("items.factType"),
      value: itemTypeMeta(item.type).label,
    },
    {
      key: "version",
      label: t("items.factVersion"),
      value: t("catalog.versionLabel", { version: item.version }),
    },
    {
      key: "source",
      label: t("items.factSource"),
      value: t(`items.zone.${item.zone}`),
    },
  ];
  if (sizeBytes != null && sizeBytes > 0) {
    facts.push({
      key: "size",
      label: t("catalog.detailSize"),
      value: formatBytes(sizeBytes),
    });
  }
  facts.push({
    key: "id",
    label: t("items.factId"),
    value: item.effectiveId,
    mono: true,
  });

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

export function ItemDetailView({
  itemId,
  backAriaLabel,
  onBack,
  onItemIdChange,
}: {
  itemId: string;
  backAriaLabel: string;
  onBack: () => void;
  /** The item's id changed (edit details renamed it). */
  onItemIdChange: (effectiveId: string) => void;
}) {
  const { t } = useTranslation("studio");
  const [item, setItem] = useState<ItemSummary | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState<ItemDetailTab>("about");
  const [unlinkOpen, setUnlinkOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const openThemeEditor = useOpenAppearanceThemeEditor();
  const [changelogPresent, setChangelogPresent] = useState(false);
  /** Bumped on every reload so the Contents tab re-reads an edited manifest. */
  const [contentsReloadKey, setContentsReloadKey] = useState(0);

  const reload = useCallback(async () => {
    setContentsReloadKey((key) => key + 1);
    try {
      setItem(pickItem(await listItems(), itemId));
    } catch (err) {
      console.error("Failed to load item details:", err);
      setItem(null);
    } finally {
      setLoaded(true);
    }
  }, [itemId]);

  // Installs, uninstalls and version switches change what is on disk.
  const itemsVersion = useItemsVersionStore((s) => s.version);
  useEffect(() => {
    void reload();
  }, [reload, itemsVersion]);

  // Keep the record fresh after edits, hide/show, and watched/linked reloads.
  useEffect(() => {
    let disposed = false;
    const unlisteners: Array<() => void> = [];
    for (const event of [WORKSHOP_CHANGED_EVENT, RELOAD_LINKED_PACKS_EVENT]) {
      void listen(event, () => void reload()).then((fn) => {
        if (disposed) fn();
        else unlisteners.push(fn);
      });
    }
    return () => {
      disposed = true;
      for (const fn of unlisteners) fn();
    };
  }, [reload]);

  /** Workshop items lead with in-app editing when there is any, else Edit details. */
  const primaryEdit = () => {
    if (item == null) return;
    if (item.type === "theme") openThemeEditor(item.effectiveId);
    else setEditOpen(true);
  };

  const handleSaveDetails = async (result: EditItemModalResult) => {
    if (item == null) return;
    setSavingEdit(true);
    try {
      const nextId = await updateItemMetadataWithRefresh(
        item.effectiveId,
        result,
      );
      if (nextId != null) {
        setEditOpen(false);
        onItemIdChange(nextId);
      }
    } finally {
      setSavingEdit(false);
    }
  };

  const canEdit = item != null && isEditableItem(item);
  /** Only themes and sound packs have a contents view. */
  const hasContents = item?.type === "theme" || item?.type === "sound";
  const sizeBytes = usePackSizeBytes({
    packDir: item?.dir,
    catalogSizeBytes: null,
  });

  // Authoring items always get the Changelog tab (add/edit); others only when present.
  useEffect(() => {
    if (item == null) return;
    if (canEdit) {
      setChangelogPresent(true);
      return;
    }
    let cancelled = false;
    setChangelogPresent(false);
    void prefetchPackChangelog(item.dir)
      .then((text) => {
        if (!cancelled) setChangelogPresent(Boolean(text?.trim()));
      })
      .catch(() => {
        if (!cancelled) setChangelogPresent(false);
      });
    return () => {
      cancelled = true;
    };
  }, [canEdit, item]);

  useEffect(() => {
    if (!changelogPresent && tab === "changelog") setTab("about");
  }, [changelogPresent, tab]);

  return (
    <BrowseView>
      <BrowseViewHeader
        className="browse-view__header--single-row"
        backAriaLabel={backAriaLabel}
        onBack={onBack}
      />
      <BrowseGridBody>
        {item == null ? (
          loaded ? (
            <p className="appearance-section__status">{t("items.notFound")}</p>
          ) : null
        ) : (
          <div className="installed-packs__detail-body">
            <header className="installed-packs__hero">
              {item.type === "theme" ? (
                <ThemeHeroPreview item={item} reloadKey={contentsReloadKey} />
              ) : (
                <ItemPreview item={item} className="installed-packs__preview" />
              )}
              <div className="installed-packs__hero-main">
                <div className="installed-packs__hero-titles">
                  <h3 className="installed-packs__name">{item.name}</h3>
                  {item.description.trim() ? (
                    <p className="installed-packs__description">
                      {item.description}
                    </p>
                  ) : null}
                  {item.zone === "installed" ? (
                    <InstalledItemActions
                      item={item}
                      onAfterUninstall={onBack}
                    />
                  ) : item.zone === "builtin" ? (
                    // Nothing to edit or remove, so Reveal is the whole action row.
                    <div className="installed-packs__hero-actions">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void openPathInFileManager(item.dir)}
                      >
                        {revealInFileManagerLabel()}
                      </Button>
                    </div>
                  ) : item.zone === "linked" ? (
                    <div className="installed-packs__hero-actions">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setUnlinkOpen(true)}
                      >
                        <IconUnlink aria-hidden />
                        {t("items.unlink")}
                      </Button>
                      <ItemActionsMenu
                        item={item}
                        variant="secondary"
                        size="sm"
                        omitRemove
                        onAfterEdit={onItemIdChange}
                      />
                    </div>
                  ) : item.zone === "workshop" ? (
                    <div className="installed-packs__hero-actions">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={primaryEdit}
                      >
                        <IconPencil aria-hidden />
                        {item.type === "theme"
                          ? t("common:edit")
                          : t("items.editDetails")}
                      </Button>
                      <ItemActionsMenu
                        item={item}
                        variant="secondary"
                        size="sm"
                        omitEdit={item.type === "theme" ? "edit" : "details"}
                        onAfterRemove={onBack}
                        onAfterEdit={onItemIdChange}
                      />
                    </div>
                  ) : (
                    <div className="installed-packs__hero-actions">
                      <ItemActionsMenu
                        item={item}
                        variant="secondary"
                        size="sm"
                        onAfterRemove={onBack}
                        onAfterEdit={onItemIdChange}
                      />
                    </div>
                  )}
                  <ItemFacts item={item} sizeBytes={sizeBytes} />
                </div>
              </div>
            </header>

            {item.zone === "workshop" ? (
              <EditItemModal
                open={editOpen}
                item={item}
                saving={savingEdit}
                onClose={() => setEditOpen(false)}
                onSave={(result) => void handleSaveDetails(result)}
              />
            ) : null}

            {item.zone === "linked" ? (
              <UnlinkItemDialog
                open={unlinkOpen}
                item={item}
                onClose={() => setUnlinkOpen(false)}
                onAfterRemove={onBack}
              />
            ) : null}

            <Tabs
              value={tab}
              onChange={(value) => setTab(value as ItemDetailTab)}
              variant="underline"
              className="installed-packs__tabs"
            >
              <TabList aria-label={t("items.tabsAria")}>
                <Tab value="about">{t("items.tabAbout")}</Tab>
                {hasContents ? (
                  <Tab value="contents">{t("items.tabContents")}</Tab>
                ) : null}
                {changelogPresent ? (
                  <Tab value="changelog">{t("items.tabChangelog")}</Tab>
                ) : null}
              </TabList>
              <TabPanel
                value="about"
                className="installed-packs__tab-panel"
                keepMounted
              >
                <ItemAboutPanel item={item} busy={false} />
              </TabPanel>
              {hasContents ? (
                <TabPanel
                  value="contents"
                  className="installed-packs__tab-panel"
                >
                  <ItemContentsPanel
                    item={item}
                    reloadKey={contentsReloadKey}
                  />
                </TabPanel>
              ) : null}
              {changelogPresent ? (
                <TabPanel
                  value="changelog"
                  className="installed-packs__tab-panel"
                  keepMounted
                >
                  <ItemChangelogPanel
                    item={item}
                    busy={false}
                    onPresenceChange={canEdit ? undefined : setChangelogPresent}
                  />
                </TabPanel>
              ) : null}
            </Tabs>
          </div>
        )}
      </BrowseGridBody>
    </BrowseView>
  );
}
