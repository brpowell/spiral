import { useTranslation } from "react-i18next";
import {
  catalogItemName,
  type CatalogItemEntry,
} from "../../types/itemRegistry";
import { Button } from "../common/Button/Button";
import { PackListCard } from "./AppearancePackCard";
import { itemTypeMeta } from "./itemShared";
import { RegistryItemPreview } from "./RegistryItemPreview";

/** Catalog card: publisher under the name, a type icon on the preview, a status badge, and Update when one exists. */
export function RegistryItemCard({
  entry,
  busy,
  onOpen,
  onUpdate,
}: {
  entry: CatalogItemEntry;
  busy: boolean;
  onOpen: () => void;
  onUpdate?: () => void;
}) {
  const { t } = useTranslation(["studio", "common"]);
  const name = catalogItemName(entry);
  const publisher = entry.publisherId.trim() || t("common:unknown");
  const { label: typeLabel, icon: typeIcon } = itemTypeMeta(entry.itemType);
  const description = entry.latestVersion.description?.trim() || undefined;
  const canUpdate =
    onUpdate != null && entry.updateAvailable && entry.meetsMinAppVersion;

  const badge = !entry.meetsMinAppVersion ? (
    <span className="appearance-pack-card__badge appearance-pack-card__badge--muted">
      {t("catalog.statusRequiresUpdate")}
    </span>
  ) : entry.installed ? (
    <span className="appearance-pack-card__badge appearance-pack-card__badge--muted">
      {t("catalog.statusInstalled")}
    </span>
  ) : null;

  return (
    <PackListCard
      name={name}
      author={publisher}
      typeIcon={typeIcon}
      typeLabel={typeLabel}
      description={description}
      ariaLabel={t("catalog.cardAria", {
        name,
        author: t("catalog.typeAndPublisher", { type: typeLabel, publisher }),
      })}
      preview={
        <RegistryItemPreview
          src={entry.resolvedPreviewUrl}
          itemType={entry.itemType}
        />
      }
      badge={badge ?? undefined}
      actions={
        canUpdate ? (
          <Button
            variant="primary"
            size="xs"
            disabled={busy}
            aria-label={t("catalog.cardUpdateAria", { name })}
            onClick={(e) => {
              e.stopPropagation();
              onUpdate();
            }}
          >
            {t("catalog.statusUpdate")}
          </Button>
        ) : undefined
      }
      onOpen={onOpen}
    />
  );
}
