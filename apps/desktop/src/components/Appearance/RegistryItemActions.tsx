import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  fetchRegistryItemSafe,
  sortVersionsNewestFirst,
  versionCmp,
  versionMeetsMinApp,
} from "../../lib/itemRegistry";
import { getAppVersion } from "../../lib/tauri";
import {
  catalogItemName,
  type CatalogItemEntry,
  type RegistryVersionSummary,
} from "../../types/itemRegistry";
import { AlertConfirmation } from "../common/AlertConfirmation/AlertConfirmation";
import { Button } from "../common/Button/Button";
import {
  ButtonGroup,
  ButtonGroupSeparator,
} from "../common/ButtonGroup/ButtonGroup";
import {
  ContextMenuHeading,
  ContextMenuOptionItem,
} from "../ContextMenu/ContextMenu";
import { IconChevronDown, IconDelete } from "../icons";
import { MenuButton } from "../MenuButton/MenuButton";
import { ItemActionsMenu } from "./ItemActionsMenu";
import { UninstallItemDialog } from "./UninstallItemDialog";

/**
 * The primary actions for a registry item: Install, Update or Uninstall, with a menu to install
 * any other published version. An installed item also gets a "…" menu beside it with its own
 * actions (Reveal in Finder, and Uninstall when an update is the primary action).
 */
export function RegistryItemActions({
  entry,
  busy,
  onInstall,
  onAfterUninstall,
}: {
  entry: CatalogItemEntry;
  busy: boolean;
  /** Install the newest version, or the chosen one. Replaces any installed version. */
  onInstall: (version?: RegistryVersionSummary) => Promise<void>;
  /** Called after an uninstall succeeds. */
  onAfterUninstall?: () => void;
}) {
  const { t } = useTranslation("studio");
  const name = catalogItemName(entry);
  const installedVersion = entry.installedVersion;
  const [versions, setVersions] = useState<RegistryVersionSummary[]>([]);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [uninstallOpen, setUninstallOpen] = useState(false);
  /** A version older than the installed one, waiting for the user to confirm. */
  const [downgradeTarget, setDowngradeTarget] =
    useState<RegistryVersionSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchRegistryItemSafe({
      registryUrl: entry.registryUrl,
      publisherId: entry.publisherId,
      itemType: entry.itemType,
      id: entry.id,
    }).then((result) => {
      if (!cancelled) {
        setVersions(
          result.ok ? sortVersionsNewestFirst(result.detail.versions) : [],
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, [entry.registryUrl, entry.publisherId, entry.itemType, entry.id]);

  useEffect(() => {
    let cancelled = false;
    void getAppVersion()
      .then((v) => {
        if (!cancelled) setAppVersion(v);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const showInstall = installedVersion == null && entry.meetsMinAppVersion;
  const showUpdate = entry.updateAvailable && entry.meetsMinAppVersion;
  const blocked = !entry.meetsMinAppVersion && !entry.installed;
  const hasAlternateVersions = versions.length > 1;
  const showVersionMenu =
    versions.length > 0 &&
    (showUpdate ||
      ((showInstall || installedVersion != null) && hasAlternateVersions));

  const chooseVersion = (version: RegistryVersionSummary) => {
    if (
      installedVersion != null &&
      versionCmp(version.version, installedVersion) === -1
    ) {
      setDowngradeTarget(version);
      return;
    }
    void onInstall(version);
  };

  const primary = blocked ? (
    <Button variant="secondary" size="sm" disabled>
      {t("catalog.statusRequiresUpdate")}
    </Button>
  ) : showUpdate ? (
    <Button
      variant="primary"
      size="sm"
      disabled={busy}
      onClick={() => void onInstall()}
    >
      {t("catalog.actionUpdate")}
    </Button>
  ) : showInstall ? (
    <Button
      variant="primary"
      size="sm"
      disabled={busy}
      onClick={() => void onInstall()}
    >
      {t("catalog.actionInstall")}
    </Button>
  ) : (
    <Button
      variant="secondary"
      size="sm"
      disabled={busy}
      onClick={() => setUninstallOpen(true)}
    >
      <IconDelete aria-hidden />
      {t("items.uninstall")}
    </Button>
  );

  const versionMenu = (
    <MenuButton
      ariaLabel={t("catalog.menuInstallVersion")}
      icon={<IconChevronDown />}
      variant={showUpdate || showInstall ? "primary" : "secondary"}
      size="sm"
      triggerPlacement="below-start"
      disabled={busy}
      layoutDeps={[
        versions.map((v) => v.version).join(","),
        installedVersion,
        appVersion,
        busy,
      ]}
    >
      {(close) => (
        <>
          <ContextMenuHeading>
            {t("catalog.menuInstallVersionHeading")}
          </ContextMenuHeading>
          {versions.map((option) => {
            const isCurrent = option.version === installedVersion;
            const meetsMin =
              appVersion == null ||
              versionMeetsMinApp(option.minAppVersion, appVersion);
            return (
              <ContextMenuOptionItem
                key={option.version}
                label={t("catalog.versionLabel", { version: option.version })}
                selected={isCurrent}
                disabled={busy || isCurrent || !meetsMin}
                onClick={() => {
                  close();
                  chooseVersion(option);
                }}
              />
            );
          })}
        </>
      )}
    </MenuButton>
  );

  const showMoreMenu = installedVersion != null;

  return (
    <>
      <div className="installed-packs__hero-actions">
        <ButtonGroup aria-label={t("catalog.menuInstallVersion")}>
          {primary}
          {showVersionMenu ? (
            <>
              <ButtonGroupSeparator />
              {versionMenu}
            </>
          ) : null}
        </ButtonGroup>
        {showMoreMenu ? (
          <ItemActionsMenu
            item={{
              effectiveId: entry.effectiveId,
              type: entry.itemType,
              name,
              zone: "installed",
            }}
            variant="secondary"
            size="sm"
            omitRemove={!showUpdate}
            onAfterRemove={onAfterUninstall}
          />
        ) : null}
      </div>

      <UninstallItemDialog
        open={uninstallOpen}
        item={{ effectiveId: entry.effectiveId, type: entry.itemType, name }}
        onClose={() => setUninstallOpen(false)}
        onAfterRemove={onAfterUninstall}
      />

      <AlertConfirmation
        open={downgradeTarget != null}
        onClose={() => setDowngradeTarget(null)}
        title={t("catalog.downgradeConfirmTitle")}
        confirmLabel={t("catalog.downgradeConfirmLabel")}
        confirmVariant="primary"
        onConfirm={() => {
          const target = downgradeTarget;
          setDowngradeTarget(null);
          if (target) void onInstall(target);
        }}
      >
        {t("catalog.downgradeConfirmBody", {
          name,
          installed: installedVersion ?? "",
          version: downgradeTarget?.version ?? "",
        })}
      </AlertConfirmation>
    </>
  );
}
