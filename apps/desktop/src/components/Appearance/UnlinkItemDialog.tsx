import { useTranslation } from "react-i18next";
import { unlinkItemWithRefresh } from "../../lib/items/itemActions";
import { AlertConfirmation } from "../common/AlertConfirmation/AlertConfirmation";

/** Confirmation for unlinking a linked folder (the folder on disk is left in place). */
export function UnlinkItemDialog({
  open,
  item,
  onClose,
  onAfterRemove,
}: {
  open: boolean;
  item: { dir: string; name: string };
  onClose: () => void;
  /** Called after the unlink succeeds. */
  onAfterRemove?: () => void;
}) {
  const { t } = useTranslation("studio");
  return (
    <AlertConfirmation
      open={open}
      onClose={onClose}
      title={t("items.unlinkTitle")}
      confirmLabel={t("items.unlink")}
      onConfirm={async () => {
        if (await unlinkItemWithRefresh(item.dir, item.name)) onAfterRemove?.();
      }}
    >
      {t("items.unlinkBody", { name: item.name })}
    </AlertConfirmation>
  );
}
