import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { usePackSizeBytes } from "../../hooks/usePackSizeBytes";
import { revealInFileManagerLabel } from "../../lib/fileManager";
import { formatBytes } from "../../lib/formatBytes";
import { RELOAD_LINKED_PACKS_EVENT } from "../../lib/appearanceWindow";
import { prefetchPackChangelog } from "../../lib/packs/packChangelogCache";
import { listItems, openPathInFileManager } from "../../lib/tauri";
import { WORKSHOP_CHANGED_EVENT } from "../../lib/themeBridge";
import { isEditableItem, type ItemSummary } from "../../types/item";
import { BrowseGridBody } from "../BrowseView/BrowseGridBody";
import { BrowseView } from "../BrowseView/BrowseView";
import { BrowseViewHeader } from "../BrowseView/BrowseViewHeader";
import { Tab, TabList, TabPanel, Tabs } from "../common/Tabs/Tabs";
import { ContextMenuItem } from "../ContextMenu/ContextMenu";
import { IconOpenFolder } from "../icons";
import { ItemActionsMenu } from "./ItemActionsMenu";
import { ItemAboutPanel } from "./ItemAboutPanel";
import { ItemChangelogPanel } from "./ItemChangelogPanel";
import { ItemContentsPanel } from "./ItemContentsPanel";
import { itemTypeMeta, ItemPreview } from "./itemShared";
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

  useEffect(() => {
    void reload();
  }, [reload]);

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

  const canEdit = item != null && isEditableItem(item);
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
        title={t("items.detailsTitle")}
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
              <ItemPreview item={item} className="installed-packs__preview" />
              <div className="installed-packs__hero-main">
                <div className="installed-packs__hero-titles">
                  <h3 className="installed-packs__name">{item.name}</h3>
                  {item.description.trim() ? (
                    <p className="installed-packs__description">
                      {item.description}
                    </p>
                  ) : null}
                  <div className="installed-packs__hero-actions">
                    <ItemActionsMenu
                      item={item}
                      variant="secondary"
                      size="sm"
                      onAfterRemove={onBack}
                      onAfterEdit={onItemIdChange}
                      extra={(close) =>
                        item.zone === "builtin" ? null : (
                          <ContextMenuItem
                            icon={<IconOpenFolder />}
                            label={revealInFileManagerLabel()}
                            onClick={() => {
                              close();
                              void openPathInFileManager(item.dir);
                            }}
                          />
                        )
                      }
                    />
                  </div>
                  <ItemFacts item={item} sizeBytes={sizeBytes} />
                </div>
              </div>
            </header>

            <Tabs
              value={tab}
              onChange={(value) => setTab(value as ItemDetailTab)}
              variant="underline"
              className="installed-packs__tabs"
            >
              <TabList aria-label={t("items.tabsAria")}>
                <Tab value="about">{t("items.tabAbout")}</Tab>
                <Tab value="contents">{t("items.tabContents")}</Tab>
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
              <TabPanel value="contents" className="installed-packs__tab-panel">
                <ItemContentsPanel item={item} reloadKey={contentsReloadKey} />
              </TabPanel>
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
