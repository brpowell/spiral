import { useTranslation } from "react-i18next";
import {
  cancelPendingSpcardReplace,
  confirmPendingSpcardReplace,
} from "../../lib/spcardInstall";
import { useLicenseStore } from "../../store/useLicenseStore";
import { AlertConfirmation } from "../common/AlertConfirmation/AlertConfirmation";

export function ReplaceSpiralCardDialog() {
  const { t } = useTranslation("common");
  const pendingReplacePath = useLicenseStore((s) => s.pendingReplacePath);
  const open = pendingReplacePath != null;

  return (
    <AlertConfirmation
      open={open}
      onClose={cancelPendingSpcardReplace}
      title={t("spiralCard.replaceTitle")}
      titleId="replace-spiral-card-title"
      confirmLabel={t("spiralCard.replaceConfirm")}
      onConfirm={confirmPendingSpcardReplace}
    >
      <p>{t("spiralCard.replaceBody")}</p>
    </AlertConfirmation>
  );
}
