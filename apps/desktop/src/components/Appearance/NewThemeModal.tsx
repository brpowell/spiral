import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../common/Button/Button";
import { FormField } from "../common/Field/Field";
import {
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalHeaderMain,
  ModalTitle,
} from "../common/Modal/Modal";
import { TextInput } from "../common/TextInput/TextInput";

export interface NewThemeModalResult {
  name: string;
}

interface NewThemeModalProps {
  open: boolean;
  creating: boolean;
  onClose: () => void;
  onCreate: (result: NewThemeModalResult) => void;
}

export function NewThemeModal({
  open,
  creating,
  onClose,
  onCreate,
}: NewThemeModalProps) {
  const { t } = useTranslation(["studio", "common"]);
  const titleId = useId();
  const [themeName, setThemeName] = useState("");

  useEffect(() => {
    if (open) setThemeName("");
  }, [open]);

  const trimmedName = themeName.trim();
  const canSubmit = trimmedName.length > 0 && !creating;

  const handleSubmit = () => {
    if (!canSubmit) return;
    onCreate({ name: trimmedName });
  };

  return (
    <Modal
      open={open}
      onClose={() => !creating && onClose()}
      size="sm"
      labelledBy={titleId}
    >
      <ModalHeader>
        <ModalHeaderMain>
          <ModalTitle id={titleId}>{t("themes.newTitle")}</ModalTitle>
        </ModalHeaderMain>
      </ModalHeader>
      <ModalBody>
        <FormField label={t("common:name")}>
          <TextInput
            value={themeName}
            onChange={(e) => setThemeName(e.target.value)}
            placeholder={t("themes.namePlaceholder")}
            autoFocus
            disabled={creating}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleSubmit();
              }
            }}
          />
        </FormField>
      </ModalBody>
      <ModalFooter onCancel={onClose} cancelDisabled={creating}>
        <Button variant="primary" disabled={!canSubmit} onClick={handleSubmit}>
          {creating ? t("common:creating") : t("common:create")}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
