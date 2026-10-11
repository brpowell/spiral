import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  isAuthorId,
  isPackId,
  isPackSemver,
} from "../../lib/packs/packManifest";
import type { PackSummary } from "../../types/pack";
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

export interface EditPackModalResult {
  packId: string;
  authorId: string;
  name: string;
  version: string;
  description: string;
}

interface EditPackModalProps {
  open: boolean;
  pack: PackSummary | null;
  saving: boolean;
  onClose: () => void;
  onSave: (result: EditPackModalResult) => void;
}

export function EditPackModal({
  open,
  pack,
  saving,
  onClose,
  onSave,
}: EditPackModalProps) {
  const { t } = useTranslation(["studio", "common"]);
  const titleId = useId();
  const [packId, setPackId] = useState("");
  const [name, setName] = useState("");
  const [authorId, setAuthorId] = useState("");
  const [version, setVersion] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (!open || !pack) return;
    setPackId(pack.packId);
    setName(pack.name);
    setAuthorId(pack.authorId);
    setVersion(pack.version);
    setDescription(pack.description);
  }, [open, pack]);

  const trimmedPackId = packId.trim();
  const trimmedAuthorId = authorId.trim();
  const trimmedVersion = version.trim();
  const packIdValid = isPackId(trimmedPackId);
  const authorIdValid = isAuthorId(trimmedAuthorId);
  const versionValid = isPackSemver(trimmedVersion);
  const canSubmit =
    name.trim().length > 0 &&
    packIdValid &&
    authorIdValid &&
    versionValid &&
    !saving;

  const handleSubmit = () => {
    if (!canSubmit) return;
    onSave({
      packId: trimmedPackId,
      authorId: trimmedAuthorId,
      name: name.trim(),
      version: trimmedVersion,
      description: description.trim(),
    });
  };

  return (
    <Modal
      open={open}
      onClose={() => !saving && onClose()}
      size="sm"
      labelledBy={titleId}
    >
      <ModalHeader>
        <ModalHeaderMain>
          <ModalTitle id={titleId}>{t("packs.editTitle")}</ModalTitle>
        </ModalHeaderMain>
      </ModalHeader>
      <ModalBody>
        <FormField label={t("common:name")}>
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("packs.namePlaceholder")}
            autoFocus
            disabled={saving}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleSubmit();
              }
            }}
          />
        </FormField>
        <FormField
          label={t("packs.packId")}
          description={
            packId.length > 0 && !packIdValid
              ? t("packs.packIdInvalid")
              : t("packs.packIdHint")
          }
        >
          <TextInput
            value={packId}
            onChange={(e) => setPackId(e.target.value)}
            placeholder={t("packs.packIdPlaceholder")}
            disabled={saving}
            spellCheck={false}
            autoComplete="off"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleSubmit();
              }
            }}
          />
        </FormField>
        <FormField
          label={t("packs.authorId")}
          description={
            authorId.length > 0 && !authorIdValid
              ? t("packs.authorIdInvalid")
              : t("packs.authorIdHint")
          }
        >
          <TextInput
            value={authorId}
            onChange={(e) => setAuthorId(e.target.value)}
            placeholder={t("packs.authorIdPlaceholder")}
            disabled={saving}
            spellCheck={false}
            autoComplete="off"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleSubmit();
              }
            }}
          />
        </FormField>
        <FormField
          label={t("packs.version")}
          description={
            version.length > 0 && !versionValid
              ? t("packs.versionInvalid")
              : t("packs.versionHint")
          }
        >
          <TextInput
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            placeholder={t("packs.versionPlaceholder")}
            disabled={saving}
            spellCheck={false}
            autoComplete="off"
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
            disabled={saving}
            autoSize
          />
        </FormField>
      </ModalBody>
      <ModalFooter onCancel={onClose} cancelDisabled={saving}>
        <Button variant="primary" disabled={!canSubmit} onClick={handleSubmit}>
          {saving ? t("common:saving") : t("common:save")}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
