import { useEffect, useId, useState } from "react";
import { isAuthorId, isPackId, isPackSemver } from "../../lib/packs/packManifest";
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
          <ModalTitle id={titleId}>Edit Pack</ModalTitle>
        </ModalHeaderMain>
      </ModalHeader>
      <ModalBody>
        <FormField label="Name">
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Pack name"
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
          label="Pack ID"
          description={
            packId.length > 0 && !packIdValid
              ? "Use lowercase letters, numbers, and hyphens (e.g. my-pack)."
              : "Lowercase letters, numbers, and hyphens."
          }
        >
          <TextInput
            value={packId}
            onChange={(e) => setPackId(e.target.value)}
            placeholder="my-pack"
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
          label="Author ID"
          description={
            authorId.length > 0 && !authorIdValid
              ? "Use lowercase letters, numbers, and hyphens (e.g. jane-doe)."
              : "Kebab slug identifying who maintains this pack."
          }
        >
          <TextInput
            value={authorId}
            onChange={(e) => setAuthorId(e.target.value)}
            placeholder="jane-doe"
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
          label="Version"
          description={
            version.length > 0 && !versionValid
              ? "Use semver MAJOR.MINOR.PATCH (e.g. 1.0.0)."
              : "Semver, e.g. 1.0.0"
          }
        >
          <TextInput
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            placeholder="0.0.0"
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
        <FormField label="Description">
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Short description"
            rows={2}
            disabled={saving}
            autoSize
          />
        </FormField>
      </ModalBody>
      <ModalFooter onCancel={onClose} cancelDisabled={saving}>
        <Button
          variant="primary"
          disabled={!canSubmit}
          onClick={handleSubmit}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
