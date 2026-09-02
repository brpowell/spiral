import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  collectClearablePackSkinSettings,
  type ClearableSkinSetting,
} from "../../lib/packs/packSkinSettings";
import type { PackSummary } from "../../types/pack";
import { AlertConfirmation } from "../common/AlertConfirmation/AlertConfirmation";
import { Checkbox } from "../common/Checkbox/Checkbox";

export interface UninstallPackDialogProps {
  pack: PackSummary | null;
  onClose: () => void;
  onConfirm: (clearSkinSettings: ClearableSkinSetting[]) => void | Promise<void>;
}

export function UninstallPackDialog({
  pack,
  onClose,
  onConfirm,
}: UninstallPackDialogProps) {
  const { t } = useTranslation("studio");
  const [clearSettings, setClearSettings] = useState(false);
  const [clearable, setClearable] = useState<ClearableSkinSetting[]>([]);

  useEffect(() => {
    if (!pack) {
      setClearSettings(false);
      setClearable([]);
      return;
    }
    setClearSettings(false);
    setClearable([]);
    let cancelled = false;
    void collectClearablePackSkinSettings(pack).then((entries) => {
      if (!cancelled) setClearable(entries);
    });
    return () => {
      cancelled = true;
    };
  }, [pack]);

  return (
    <AlertConfirmation
      open={pack != null}
      onClose={onClose}
      title={t("catalog.uninstallConfirmTitle")}
      confirmLabel={t("catalog.actionUninstall")}
      onConfirm={() => onConfirm(clearSettings ? clearable : [])}
    >
      <p>
        {t("catalog.uninstallConfirmBody", {
          name: pack?.name ?? "",
        })}
      </p>
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
