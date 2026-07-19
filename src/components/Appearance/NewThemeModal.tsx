import { useEffect, useId, useState } from "react";
import { listPacks } from "../../lib/tauri";
import { isAuthoringPackZone, type PackSummary } from "../../types/pack";
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
import { NativeSelect } from "../common/NativeSelect/NativeSelect";
import { TextInput } from "../common/TextInput/TextInput";

const PACK_UNSELECTED = "";
const CREATE_NEW_PACK = "__create_new__";

export interface NewThemeModalResult {
  name: string;
  packMode: "new" | "existing";
  packId?: string;
  packName?: string;
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
  const titleId = useId();

  const [themeName, setThemeName] = useState("");
  const [packName, setPackName] = useState("");
  const [packNameDirty, setPackNameDirty] = useState(false);
  const [packSelection, setPackSelection] = useState(PACK_UNSELECTED);
  const [authoringPacks, setAuthoringPacks] = useState<PackSummary[]>([]);
  const [packsLoading, setPacksLoading] = useState(false);

  useEffect(() => {
    if (!open) return;

    setThemeName("");
    setPackName("");
    setPackNameDirty(false);
    setPackSelection(PACK_UNSELECTED);
    setPacksLoading(true);

    let cancelled = false;
    void listPacks()
      .then((packs) => {
        if (cancelled) return;
        const authoring = packs
          .filter((p) => isAuthoringPackZone(p.zone))
          .sort((a, b) => a.name.localeCompare(b.name));
        setAuthoringPacks(authoring);
      })
      .catch(() => {
        if (cancelled) return;
        setAuthoringPacks([]);
      })
      .finally(() => {
        if (!cancelled) setPacksLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  const hasAuthoringPacks = authoringPacks.length > 0;
  const creatingNewPack =
    !hasAuthoringPacks || packSelection === CREATE_NEW_PACK;

  const handleThemeNameChange = (value: string) => {
    setThemeName(value);
    if (!packNameDirty) {
      setPackName(value);
    }
  };

  const handlePackNameChange = (value: string) => {
    setPackNameDirty(true);
    setPackName(value);
  };

  const canSubmit =
    themeName.trim().length > 0 &&
    !creating &&
    !packsLoading &&
    (creatingNewPack
      ? packName.trim().length > 0
      : packSelection !== PACK_UNSELECTED);

  const handleSubmit = () => {
    if (!canSubmit) return;
    const name = themeName.trim();
    if (creatingNewPack) {
      onCreate({
        name,
        packMode: "new",
        packName: packName.trim(),
      });
      return;
    }
    onCreate({ name, packMode: "existing", packId: packSelection });
  };

  const packOptions = [
    { value: PACK_UNSELECTED, label: "Select a pack…", disabled: true },
    ...authoringPacks.map((pack) => ({
      value: pack.packId,
      label:
        pack.zone === "linked"
          ? `${pack.name || pack.packId} (Linked)`
          : pack.name || pack.packId,
    })),
    { value: CREATE_NEW_PACK, label: "Create a new pack" },
  ];

  return (
    <Modal
      open={open}
      onClose={() => !creating && onClose()}
      size="sm"
      labelledBy={titleId}
    >
      <ModalHeader>
        <ModalHeaderMain>
          <ModalTitle id={titleId}>New Theme</ModalTitle>
        </ModalHeaderMain>
      </ModalHeader>
      <ModalBody>
        <FormField label="Name">
          <TextInput
            value={themeName}
            onChange={(e) => handleThemeNameChange(e.target.value)}
            placeholder="My theme"
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

        {hasAuthoringPacks ? (
          <FormField
            label="Pack"
            description="Add this theme to an existing pack, or create a new one."
          >
            <NativeSelect
              aria-label="Pack"
              value={packSelection}
              onChange={setPackSelection}
              disabled={creating || packsLoading}
              options={packOptions}
            />
          </FormField>
        ) : null}

        {creatingNewPack ? (
          <FormField
            label="Pack name"
          >
            <TextInput
              value={packName}
              onChange={(e) => handlePackNameChange(e.target.value)}
              placeholder="My theme"
              disabled={creating}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
            />
          </FormField>
        ) : null}
      </ModalBody>
      <ModalFooter onCancel={onClose} cancelDisabled={creating}>
        <Button
          variant="primary"
          disabled={!canSubmit}
          onClick={handleSubmit}
        >
          {creating ? "Creating…" : "Create"}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
