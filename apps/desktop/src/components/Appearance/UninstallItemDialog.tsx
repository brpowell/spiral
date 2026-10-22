import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { uninstallItemWithRefresh } from "../../lib/items/itemActions";
import {
  collectClearableSkinSettings,
  type ClearableSkinSetting,
} from "../../lib/packs/packSkinSettings";
import type { ItemType } from "../../types/item";
import { AlertConfirmation } from "../common/AlertConfirmation/AlertConfirmation";
import { Checkbox } from "../common/Checkbox/Checkbox";

/** Confirmation for uninstalling an installed item (skins can also clear their saved settings). */
export function UninstallItemDialog({
  open,
  item,
  onClose,
  onAfterRemove,
}: {
  open: boolean;
  item: { effectiveId: string; type: ItemType; name: string };
  onClose: () => void;
  /** Called after the uninstall succeeds. */
  onAfterRemove?: () => void;
}) {
  const { t } = useTranslation("studio");
  const [clearable, setClearable] = useState<ClearableSkinSetting[]>([]);
  const [clearSettings, setClearSettings] = useState(false);

  useEffect(() => {
    if (!open || item.type !== "skin") {
      setClearable([]);
      setClearSettings(false);
      return;
    }
    let cancelled = false;
    void collectClearableSkinSettings([item.effectiveId]).then((entries) => {
      if (!cancelled) setClearable(entries);
    });
    return () => {
      cancelled = true;
    };
  }, [open, item.type, item.effectiveId]);

  return (
    <AlertConfirmation
      open={open}
      onClose={onClose}
      title={t("items.uninstallTitle")}
      confirmLabel={t("items.uninstall")}
      onConfirm={async () => {
        const ok = await uninstallItemWithRefresh(
          item.effectiveId,
          clearSettings ? clearable : [],
        );
        if (ok) onAfterRemove?.();
      }}
    >
      <p>{t("items.uninstallBody", { name: item.name })}</p>
      {clearable.length > 0 ? (
        <Checkbox
          className="alert-confirmation__option"
          checked={clearSettings}
          onChange={(event) => setClearSettings(event.target.checked)}
        >
          {t("catalog.uninstallClearSettings")}
        </Checkbox>
      ) : null}
    </AlertConfirmation>
  );
}
