import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatBytes } from "../../lib/formatBytes";
import {
  fetchRegistryItemVersionSafe,
  peekRegistryItemVersion,
} from "../../lib/itemRegistry";
import {
  catalogItemName,
  type CatalogItemEntry,
  type RegistryVersionSummary,
} from "../../types/itemRegistry";
import { BrowseGridBody } from "../BrowseView/BrowseGridBody";
import { BrowseView } from "../BrowseView/BrowseView";
import { BrowseViewHeader } from "../BrowseView/BrowseViewHeader";
import { MarkdownBody } from "../common/MarkdownBody/MarkdownBody";
import { Skeleton } from "../common/Skeleton/Skeleton";
import { Tab, TabList, TabPanel, Tabs } from "../common/Tabs/Tabs";
import { RegistryItemActions } from "./RegistryItemActions";
import { itemTypeMeta } from "./itemShared";
import { RegistryItemPreview } from "./RegistryItemPreview";
import "./InstalledPacksSection.css";
import "./AppearanceSection.css";
import "./RegistryBrowse.css";

type DetailTab = "about" | "changelog";

type Docs = { readme: string | null; changelog: string | null };

/** Release notes for one version: loaded once, cached by the registry layer. */
function useVersionDocs(
  entry: CatalogItemEntry,
  version: string,
): { docs: Docs | null; status: "loading" | "ready" | "error" } {
  const ref = {
    registryUrl: entry.registryUrl,
    publisherId: entry.publisherId,
    itemType: entry.itemType,
    id: entry.id,
    version,
  };
  const cached = peekRegistryItemVersion(ref);
  const [state, setState] = useState<{
    docs: Docs | null;
    status: "loading" | "ready" | "error";
  }>(() =>
    cached?.ok
      ? { docs: docsOf(cached.detail), status: "ready" }
      : { docs: null, status: "loading" },
  );

  useEffect(() => {
    let cancelled = false;
    const hit = peekRegistryItemVersion(ref);
    if (hit?.ok) {
      setState({ docs: docsOf(hit.detail), status: "ready" });
      return;
    }
    setState({ docs: null, status: "loading" });
    void fetchRegistryItemVersionSafe(ref).then((result) => {
      if (cancelled) return;
      setState(
        result.ok
          ? { docs: docsOf(result.detail), status: "ready" }
          : { docs: null, status: "error" },
      );
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.registryUrl, entry.publisherId, entry.itemType, entry.id, version]);

  return state;
}

function docsOf(detail: {
  readme?: string | null;
  changelog?: string | null;
}): Docs {
  return {
    readme: detail.readme?.trim() || null,
    changelog: detail.changelog?.trim() || null,
  };
}

function DocPanel({
  status,
  text,
  loadingLabel,
  failedLabel,
  emptyLabel,
}: {
  status: "loading" | "ready" | "error";
  text: string | null;
  loadingLabel: string;
  failedLabel: string;
  emptyLabel: string;
}) {
  if (status === "loading") {
    return (
      <div role="status" aria-label={loadingLabel}>
        <Skeleton width="60%" height="0.9rem" radius="sm" />
      </div>
    );
  }
  if (status === "error") {
    return <p className="appearance-section__status">{failedLabel}</p>;
  }
  if (!text) {
    return <p className="appearance-section__status">{emptyLabel}</p>;
  }
  return <MarkdownBody source={text} />;
}

/**
 * A registry item before (or after) it is installed: preview, facts, README and changelog,
 * Install / Update, any published version, and the usual item actions once it is installed.
 */
export function RegistryItemDetailView({
  entry,
  busy,
  backAriaLabel,
  onBack,
  onInstall,
}: {
  entry: CatalogItemEntry;
  busy: boolean;
  backAriaLabel: string;
  onBack: () => void;
  /** Install the newest version, or the chosen one. Replaces any installed version. */
  onInstall: (version?: RegistryVersionSummary) => Promise<void>;
}) {
  const { t } = useTranslation(["studio", "common"]);
  const [tab, setTab] = useState<DetailTab>("about");

  const latest = entry.latestVersion;
  const name = catalogItemName(entry);
  const installedVersion = entry.installedVersion;
  const { docs, status } = useVersionDocs(entry, latest.version);

  const changelogPresent = status === "ready" && Boolean(docs?.changelog);
  useEffect(() => {
    if (!changelogPresent && tab === "changelog") setTab("about");
  }, [changelogPresent, tab]);

  const facts = useMemo(() => {
    const list: Array<{
      key: string;
      label: string;
      value: string;
      mono?: boolean;
    }> = [
      {
        key: "type",
        label: t("items.factType"),
        value: itemTypeMeta(entry.itemType).label,
      },
      {
        key: "version",
        label: t("catalog.detailVersion"),
        value: t("catalog.versionLabel", { version: latest.version }),
      },
      {
        key: "publisher",
        label: t("catalog.detailPublisher"),
        value: entry.publisherId,
      },
    ];
    if (installedVersion != null) {
      list.push({
        key: "installed",
        label: t("catalog.detailInstalled"),
        value: t("catalog.versionLabel", { version: installedVersion }),
      });
    }
    if (latest.sizeBytes > 0) {
      list.push({
        key: "size",
        label: t("catalog.detailSize"),
        value: formatBytes(latest.sizeBytes),
      });
    }
    list.push({
      key: "id",
      label: t("items.factId"),
      value: entry.effectiveId,
      mono: true,
    });
    return list;
  }, [entry, installedVersion, latest, t]);

  const description = latest.description?.trim();

  return (
    <BrowseView>
      <BrowseViewHeader
        className="browse-view__header--single-row"
        backAriaLabel={backAriaLabel}
        onBack={onBack}
      />
      <BrowseGridBody>
        <div className="installed-packs__detail-body">
          <header className="installed-packs__hero">
            <RegistryItemPreview
              src={entry.resolvedPreviewUrl}
              itemType={entry.itemType}
              className="installed-packs__preview"
            />
            <div className="installed-packs__hero-main">
              <div className="installed-packs__hero-titles">
                <h3 className="installed-packs__name">{name}</h3>
                {description ? (
                  <p className="installed-packs__description">{description}</p>
                ) : null}
                <RegistryItemActions
                  entry={entry}
                  busy={busy}
                  onInstall={onInstall}
                />
                <dl className="installed-packs__facts">
                  {facts.map((fact) => (
                    <div key={fact.key} className="installed-packs__fact">
                      <dt className="installed-packs__fact-label">
                        {fact.label}
                      </dt>
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
              </div>
            </div>
          </header>

          <Tabs
            value={tab}
            onChange={(value) => setTab(value as DetailTab)}
            variant="underline"
            className="installed-packs__tabs"
          >
            <TabList aria-label={t("items.tabsAria")}>
              <Tab value="about">{t("items.tabAbout")}</Tab>
              {changelogPresent ? (
                <Tab value="changelog">{t("items.tabChangelog")}</Tab>
              ) : null}
            </TabList>
            <TabPanel
              value="about"
              className="installed-packs__tab-panel"
              keepMounted
            >
              <DocPanel
                status={status}
                text={docs?.readme ?? null}
                loadingLabel={t("catalog.readmeLoading")}
                failedLabel={t("catalog.readmeLoadFailed")}
                emptyLabel={t("catalog.readmeEmpty")}
              />
            </TabPanel>
            {changelogPresent ? (
              <TabPanel
                value="changelog"
                className="installed-packs__tab-panel"
                keepMounted
              >
                <DocPanel
                  status={status}
                  text={docs?.changelog ?? null}
                  loadingLabel={t("catalog.changelogLoading")}
                  failedLabel={t("catalog.changelogLoadFailed")}
                  emptyLabel={t("catalog.changelogEmpty")}
                />
              </TabPanel>
            ) : null}
          </Tabs>
        </div>
      </BrowseGridBody>
    </BrowseView>
  );
}
