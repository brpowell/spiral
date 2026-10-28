import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useTagWriteConfirmStore } from "../../store/useTagWriteConfirmStore";
import { IconWarning } from "../icons";
import { Alert } from "../common/Alert/Alert";
import { AlertConfirmation } from "../common/AlertConfirmation/AlertConfirmation";
import { Checkbox } from "../common/Checkbox/Checkbox";
import "./TagWriteConfirmDialog.css";

export function TagWriteConfirmDialog() {
  const { t } = useTranslation("dialogs");
  const prompt = useTagWriteConfirmStore((state) => state.prompt);
  const answerPrompt = useTagWriteConfirmStore((state) => state.answerPrompt);
  const [dontAskAgain, setDontAskAgain] = useState(false);

  useEffect(() => {
    if (prompt) setDontAskAgain(false);
  }, [prompt]);

  // Keep the last prompt's copy rendered while the dialog fades out.
  const [shown, setShown] = useState(prompt);
  useEffect(() => {
    if (prompt) setShown(prompt);
  }, [prompt]);

  const context = shown?.context ?? "track";
  const count = shown?.fileCount ?? 1;

  return (
    <AlertConfirmation
      open={prompt != null}
      onClose={() => void answerPrompt(false, false)}
      title={t("tagWrite.title", { count })}
      confirmLabel={t("tagWrite.confirm")}
      confirmVariant="primary"
      panelClassName="tag-write-confirm"
      onConfirm={() => answerPrompt(true, dontAskAgain)}
    >
      <p>{t(`tagWrite.message.${context}`, { count })}</p>
      <Alert
        variant="warning"
        icon={<IconWarning />}
        className="tag-write-confirm__alert"
      >
        {t("tagWrite.backup")}
      </Alert>
      <div className="alert-confirmation__option">
        <Checkbox
          checked={dontAskAgain}
          onChange={(e) => setDontAskAgain(e.target.checked)}
        >
          {t(`tagWrite.dontAskAgain.${context}`)}
        </Checkbox>
      </div>
    </AlertConfirmation>
  );
}
