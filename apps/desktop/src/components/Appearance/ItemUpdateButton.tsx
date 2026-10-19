import { useState } from "react";
import { useTranslation } from "react-i18next";
import { installRegistryItem } from "../../lib/itemRegistry";
import { useItemUpdatesStore } from "../../store/useItemUpdatesStore";
import type { PackZone } from "../../types/pack";
import { Button } from "../common/Button/Button";

/**
 * "Update" pill for a collection card's preview corner. Shows only for an installed item with
 * a newer version waiting, and installs the version the update check found.
 */
export function ItemUpdateButton({
  effectiveId,
  zone,
  name,
}: {
  effectiveId: string;
  zone: PackZone;
  name: string;
}) {
  const { t } = useTranslation("studio");
  const update = useItemUpdatesStore((s) =>
    s.pendingUpdates.find((u) => u.effectiveId === effectiveId),
  );
  const [updating, setUpdating] = useState(false);

  if (zone !== "installed" || update == null) return null;

  return (
    <Button
      variant="primary"
      size="xs"
      disabled={updating}
      aria-label={t("catalog.cardUpdateAria", { name })}
      onClick={() => {
        setUpdating(true);
        void installRegistryItem({
          registryUrl: update.registryUrl,
          publisherId: update.publisherId,
          itemType: update.itemType,
          id: update.id,
          version: update.latest.version,
          sha256: update.latest.sha256,
          sizeBytes: update.latest.sizeBytes,
          minAppVersion: update.latest.minAppVersion,
          name,
        }).finally(() => setUpdating(false));
      }}
    >
      {t("catalog.statusUpdate")}
    </Button>
  );
}
