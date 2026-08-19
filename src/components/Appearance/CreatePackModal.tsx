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
import { Textarea } from "../common/Textarea/Textarea";
import { TextInput } from "../common/TextInput/TextInput";

export interface CreatePackModalResult {
  name: string;
  description: string;
}

interface CreatePackModalProps {
  open: boolean;
  creating: boolean;
  onClose: () => void;
  onCreate: (result: CreatePackModalResult) => void;
}

export function CreatePackModal({
  open,
  creating,
  onClose,
  onCreate,
}: CreatePackModalProps) {
  const { t } = useTranslation(["studio", "common"]);
  const titleId = useId();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (!open) return;
    setName("");
    setDescription("");
  }, [open]);

  const canSubmit = name.trim().length > 0 && !creating;

  const handleSubmit = () => {
    if (!canSubmit) return;
    onCreate({
      name: name.trim(),
      description: description.trim(),
    });
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
          <ModalTitle id={titleId}>{t("packs.createTitle")}</ModalTitle>
        </ModalHeaderMain>
      </ModalHeader>
      <ModalBody>
        <FormField label={t("common:name")}>
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("packs.namePlaceholder")}
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
        <FormField label={t("common:description")}>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t("packs.descriptionPlaceholder")}
            rows={2}
            disabled={creating}
            autoSize
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
