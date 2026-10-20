import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import {
  deleteLinkedItemWithRefresh,
  unlinkItemWithRefresh,
} from "../../lib/items/itemActions";
import { Button } from "../common/Button/Button";
import {
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from "../common/Modal/Modal";
import { RadioGroup, RadioGroupItem } from "../common/RadioGroup/RadioGroup";
import "./RemoveItemDialog.css";

type RemoveMode = "unlink" | "delete";

/**
 * Remove a linked item: either unlink it (the folder stays on disk) or delete it (the folder
 * is removed from disk too). Linked items behave the same wherever their folder lives.
 */
export function RemoveItemDialog({
  open,
  item,
  onClose,
  onAfterRemove,
}: {
  open: boolean;
  item: { effectiveId: string; dir: string; name: string };
  onClose: () => void;
  /** Called after the item is removed. */
  onAfterRemove?: () => void;
}) {
  const { t } = useTranslation(["studio", "common"]);
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<RemoveMode>("unlink");
  const [busy, setBusy] = useState(false);

  useFocusTrap(dialogRef, open);

  useEffect(() => {
    if (open) setMode("unlink");
  }, [open]);

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const ok =
        mode === "delete"
          ? await deleteLinkedItemWithRefresh(item.effectiveId, item.name)
          : await unlinkItemWithRefresh(item.dir, item.name);
      if (ok) {
        onClose();
        onAfterRemove?.();
      }
    } finally {
      setBusy(false);
    }
  };

  const options: { value: RemoveMode; title: string; body: string }[] = [
    {
      value: "unlink",
      title: t("items.removeUnlinkTitle"),
      body: t("items.removeUnlinkBody"),
    },
    {
      value: "delete",
      title: t("items.removeDeleteTitle"),
      body: t("items.removeDeleteBody"),
    },
  ];

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      panelClassName="remove-item-dialog"
      panelRef={dialogRef}
      labelledBy={titleId}
    >
      <ModalHeader>
        <ModalTitle id={titleId}>
          {t("items.removeTitle", { name: item.name })}
        </ModalTitle>
      </ModalHeader>

      <ModalBody>
        <RadioGroup
          value={mode}
          onChange={setMode}
          orientation="vertical"
          aria-labelledby={titleId}
          className="remove-item-dialog__options"
        >
          {options.map((option) => (
            <label
              key={option.value}
              className={[
                "remove-item-dialog__option",
                option.value === "delete" &&
                  "remove-item-dialog__option--danger",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <RadioGroupItem value={option.value} disabled={busy} />
              <span className="remove-item-dialog__option-text">
                <span className="remove-item-dialog__option-title">
                  {option.title}
                </span>
                <span className="remove-item-dialog__option-body">
                  {option.body}
                </span>
              </span>
            </label>
          ))}
        </RadioGroup>
      </ModalBody>

      <ModalFooter onCancel={onClose} cancelLabel={t("common:cancel")}>
        <Button
          variant={mode === "delete" ? "danger" : "primary"}
          onClick={() => void confirm()}
          disabled={busy}
        >
          {mode === "delete" ? t("items.delete") : t("items.unlink")}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
