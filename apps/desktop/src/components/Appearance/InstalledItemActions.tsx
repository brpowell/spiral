import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  enrichItemCatalog,
  fetchItemCatalogSafe,
  installCatalogEntry,
} from "../../lib/itemRegistry";
import { useItemsVersionStore } from "../../store/useItemsVersionStore";
import type { ItemSummary } from "../../types/item";
import type {
  CatalogItemEntry,
  RegistryVersionSummary,
} from "../../types/itemRegistry";
import { Button } from "../common/Button/Button";
import { IconDelete } from "../icons";
import { ItemActionsMenu } from "./ItemActionsMenu";
import { RegistryItemActions } from "./RegistryItemActions";
import { UninstallItemDialog } from "./UninstallItemDialog";

/** The registry's catalog row for an installed item, or `null` when no registry lists it. */
function useRegistryEntry(item: ItemSummary): CatalogItemEntry | null {
  const [entry, setEntry] = useState<CatalogItemEntry | null>(null);
  const itemsVersion = useItemsVersionStore((s) => s.version);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await fetchItemCatalogSafe({
        itemTypes: [item.type],
        publisherId: item.publisherId,
        q: item.id,
        limit: 50,
      });
      const summary = result.ok
        ? result.catalog.items.find((i) => i.effectiveId === item.effectiveId)
        : undefined;
      const [enriched] = summary
        ? await enrichItemCatalog([summary], { resolvePreviews: false })
        : [];
      if (!cancelled) setEntry(enriched ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [item.type, item.publisherId, item.id, item.effectiveId, itemsVersion]);

  return entry;
}

/**
 * Primary actions for an installed item on its details page: Uninstall, Update or another
 * version when a registry lists it, or just Uninstall when none does. Reveal in Finder and
 * the other item actions stay in the "…" menu.
 */
export function InstalledItemActions({
  item,
  onAfterUninstall,
}: {
  item: ItemSummary;
  onAfterUninstall: () => void;
}) {
  const { t } = useTranslation("studio");
  const entry = useRegistryEntry(item);
  const [busy, setBusy] = useState(false);
  const [uninstallOpen, setUninstallOpen] = useState(false);

  if (entry != null) {
    const install = async (version?: RegistryVersionSummary) => {
      setBusy(true);
      try {
        await installCatalogEntry(entry, version);
      } finally {
        setBusy(false);
      }
    };
    return (
      <RegistryItemActions
        entry={entry}
        busy={busy}
        onInstall={install}
        onAfterUninstall={onAfterUninstall}
      />
    );
  }

  return (
    <>
      <div className="installed-packs__hero-actions">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setUninstallOpen(true)}
        >
          <IconDelete aria-hidden />
          {t("items.uninstall")}
        </Button>
        <ItemActionsMenu item={item} variant="secondary" size="sm" omitRemove />
      </div>
      <UninstallItemDialog
        open={uninstallOpen}
        item={item}
        onClose={() => setUninstallOpen(false)}
        onAfterRemove={onAfterUninstall}
      />
    </>
  );
}
