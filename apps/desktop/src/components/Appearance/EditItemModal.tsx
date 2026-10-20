import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { isPublisherId, isSlug, isSemver } from "../../lib/items/itemIds";
import type { ItemSummary } from "../../types/item";
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

export interface EditItemModalResult {
  id: string;
  publisherId: string;
  name: string;
  version: string;
  description: string;
}

interface EditItemModalProps {
  open: boolean;
  item: ItemSummary | null;
  saving: boolean;
  onClose: () => void;
  onSave: (result: EditItemModalResult) => void;
}

export function EditItemModal({
  open,
  item,
  saving,
  onClose,
  onSave,
}: EditItemModalProps) {
  const { t } = useTranslation(["studio", "common"]);
  const titleId = useId();
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [publisherId, setPublisherId] = useState("");
  const [version, setVersion] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (!open || !item) return;
    setId(item.id);
    setName(item.name);
    setPublisherId(item.publisherId);
    setVersion(item.version);
    setDescription(item.description);
  }, [open, item]);

  /** Built-in ids name their folder in the source tree, so they stay fixed. */
  const lockIdentity = item?.zone === "builtin";
  const trimmedId = id.trim();
  const trimmedPublisherId = publisherId.trim();
  const trimmedVersion = version.trim();
  // Items share the pack-era kebab-slug and semver rules.
  const idValid = isSlug(trimmedId);
  const publisherIdValid = isPublisherId(trimmedPublisherId);
  const versionValid = isSemver(trimmedVersion);
  // Linked folders keep their path; their id and author can still change in the manifest.
  const canSubmit =
    name.trim().length > 0 &&
    idValid &&
    publisherIdValid &&
    versionValid &&
    !saving;

  const handleSubmit = () => {
    if (!canSubmit) return;
    onSave({
      id: trimmedId,
      publisherId: trimmedPublisherId,
      name: name.trim(),
      version: trimmedVersion,
      description: description.trim(),
    });
  };

  const submitOnEnter = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
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
          <ModalTitle id={titleId}>{t("items.editTitle")}</ModalTitle>
        </ModalHeaderMain>
      </ModalHeader>
      <ModalBody>
        <FormField label={t("common:name")}>
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("items.namePlaceholder")}
            autoFocus
            disabled={saving}
            onKeyDown={submitOnEnter}
          />
        </FormField>
        <FormField
          label={t("items.id")}
          description={
            id.length > 0 && !idValid ? t("items.idInvalid") : t("items.idHint")
          }
        >
          <TextInput
            value={id}
            onChange={(e) => setId(e.target.value)}
            placeholder={t("items.idPlaceholder")}
            disabled={saving || lockIdentity}
            spellCheck={false}
            autoComplete="off"
            onKeyDown={submitOnEnter}
          />
        </FormField>
        <FormField
          label={t("items.publisherId")}
          description={
            publisherId.length > 0 && !publisherIdValid
              ? t("items.publisherIdInvalid")
              : t("items.publisherIdHint")
          }
        >
          <TextInput
            value={publisherId}
            onChange={(e) => setPublisherId(e.target.value)}
            placeholder={t("items.publisherIdPlaceholder")}
            disabled={saving || lockIdentity}
            spellCheck={false}
            autoComplete="off"
            onKeyDown={submitOnEnter}
          />
        </FormField>
        <FormField
          label={t("items.version")}
          description={
            version.length > 0 && !versionValid
              ? t("items.versionInvalid")
              : t("items.versionHint")
          }
        >
          <TextInput
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            placeholder={t("items.versionPlaceholder")}
            disabled={saving}
            spellCheck={false}
            autoComplete="off"
            onKeyDown={submitOnEnter}
          />
        </FormField>
        <FormField label={t("common:description")}>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t("items.descriptionPlaceholder")}
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
