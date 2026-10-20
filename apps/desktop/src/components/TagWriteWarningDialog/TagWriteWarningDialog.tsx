import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertConfirmation } from "../common/AlertConfirmation/AlertConfirmation";
import { Checkbox } from "../common/Checkbox/Checkbox";

interface TagWriteWarningDialogProps {
  open: boolean;
  onClose: () => void;
  /** `dontShowAgain` reflects the checkbox at the moment of confirming. */
  onConfirm: (dontShowAgain: boolean) => void | Promise<void>;
}

export function TagWriteWarningDialog({
  open,
  onClose,
  onConfirm,
}: TagWriteWarningDialogProps) {
  const { t } = useTranslation("dialogs");
  const [dontShowAgain, setDontShowAgain] = useState(false);

  return (
    <AlertConfirmation
      open={open}
      onClose={onClose}
      size="md"
      title={t("tagWriteWarning.title")}
      titleId="tag-write-warning-title"
      confirmLabel={t("tagWriteWarning.confirm")}
      confirmVariant="primary"
      deferActionUntilClosed
      onConfirm={() => onConfirm(dontShowAgain)}
    >
      <p>{t("tagWriteWarning.body")}</p>
      <p>{t("tagWriteWarning.backup")}</p>
      <Checkbox
        className="alert-confirmation__option"
        checked={dontShowAgain}
        onChange={(e) => setDontShowAgain(e.target.checked)}
      >
        {t("tagWriteWarning.dontShowAgain")}
      </Checkbox>
    </AlertConfirmation>
  );
}
