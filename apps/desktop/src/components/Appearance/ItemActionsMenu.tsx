import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  deleteWorkshopItemWithRefresh,
  updateItemMetadataWithRefresh,
} from "../../lib/items/itemActions";
import { revealInFileManagerLabel } from "../../lib/fileManager";
import { listItems, openPathInFileManager } from "../../lib/tauri";
import type { ItemSummary, ItemType } from "../../types/item";
import { isEditablePackZone, type PackZone } from "../../types/pack";
import { AlertConfirmation } from "../common/AlertConfirmation/AlertConfirmation";
import {
  ContextMenuItem,
  ContextMenuSeparator,
} from "../ContextMenu/ContextMenu";
import {
  IconDelete,
  IconExport,
  IconOpenFolder,
  IconPackage,
  IconPencil,
  IconUnlink,
} from "../icons";
import { MenuButton } from "../MenuButton/MenuButton";
import { useOpenAppearanceThemeEditor } from "./AppearanceThemeEditorContext";
import { EditItemModal, type EditItemModalResult } from "./EditItemModal";
import { ExportItemModal } from "./ExportItemModal";
import { UninstallItemDialog } from "./UninstallItemDialog";
import { UnlinkItemDialog } from "./UnlinkItemDialog";

/** The few fields every list source (stores, `listItems`) can provide for an item. */
export interface ItemRef {
  effectiveId: string;
  type: ItemType;
  name: string;
  zone: PackZone;
}

type PendingAction = "uninstall" | "delete" | "unlink" | null;

/** Active on-disk record for an item id (workshop/linked win over installed/builtin). */
async function resolveItem(effectiveId: string): Promise<ItemSummary | null> {
  const items = await listItems();
  return (
    items.find((i) => i.effectiveId === effectiveId && i.active) ??
    items.find((i) => i.effectiveId === effectiveId) ??
    null
  );
}

/**
 * Overflow menu shared by item cards and the details view. Owns the confirmation
 * dialogs and the edit-details modal so callers only pass an item reference.
 */
export function ItemActionsMenu({
  item,
  onOpenItem,
  onAfterRemove,
  onAfterEdit,
  variant = "ghost",
  size,
  omitRemove = false,
  omitEdit,
}: {
  item: ItemRef;
  /** Shows “View details” when provided (omit on the details view itself). */
  onOpenItem?: (effectiveId: string) => void;
  /** Called after an uninstall / delete / unlink succeeds. */
  onAfterRemove?: () => void;
  /** Called with the new effective id after “Edit details” saves. */
  onAfterEdit?: (effectiveId: string) => void;
  variant?: "ghost" | "secondary";
  size?: "sm";
  /** Leave Uninstall / Unlink out when the caller offers it as a primary action. */
  omitRemove?: boolean;
  /** Leave the theme editor entry ("edit") or Edit details ("details") out when it is the primary action. */
  omitEdit?: "edit" | "details";
}) {
  const { t } = useTranslation(["studio", "common"]);
  const openThemeEditor = useOpenAppearanceThemeEditor();
  const [pending, setPending] = useState<PendingAction>(null);
  const [resolved, setResolved] = useState<ItemSummary | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const editable = isEditablePackZone(item.zone);

  const revealItem = async () => {
    const found = await resolveItem(item.effectiveId);
    if (found) await openPathInFileManager(found.dir);
  };

  const openEdit = async () => {
    const found = await resolveItem(item.effectiveId);
    if (!found) return;
    setResolved(found);
    setEditOpen(true);
  };

  const requestUnlink = async () => {
    const found = await resolveItem(item.effectiveId);
    if (!found) return;
    setResolved(found);
    setPending("unlink");
  };

  const handleSave = async (result: EditItemModalResult) => {
    setSaving(true);
    try {
      const nextId = await updateItemMetadataWithRefresh(
        item.effectiveId,
        result,
      );
      if (nextId != null) {
        setEditOpen(false);
        onAfterEdit?.(nextId);
      }
    } finally {
      setSaving(false);
    }
  };

  const finish = (ok: boolean) => {
    if (ok) onAfterRemove?.();
  };

  return (
    <>
      <MenuButton
        ariaLabel={t("items.cardActionsAria", { name: item.name })}
        title={t("common:actions")}
        variant={variant}
        size={size}
        triggerPlacement={variant === "secondary" ? "below-start" : undefined}
        layoutDeps={[item.zone, item.type, onOpenItem != null]}
      >
        {(close) => (
          <>
            {editable && item.type === "theme" && omitEdit !== "edit" ? (
              <ContextMenuItem
                icon={<IconPencil />}
                label={t("common:edit")}
                onClick={() => {
                  close();
                  openThemeEditor(item.effectiveId);
                }}
              />
            ) : null}
            {onOpenItem ? (
              <ContextMenuItem
                icon={<IconPackage />}
                label={t("items.viewDetails")}
                onClick={() => {
                  close();
                  onOpenItem(item.effectiveId);
                }}
              />
            ) : null}
            {editable &&
            (onOpenItem || (item.type === "theme" && omitEdit !== "edit")) ? (
              <ContextMenuSeparator />
            ) : null}
            {editable && omitEdit !== "details" ? (
              <ContextMenuItem
                icon={<IconPencil />}
                label={t("items.editDetails")}
                onClick={() => {
                  close();
                  void openEdit();
                }}
              />
            ) : null}
            {editable ? (
              <ContextMenuItem
                icon={<IconExport />}
                label={t("items.export")}
                onClick={() => {
                  close();
                  setExportOpen(true);
                }}
              />
            ) : null}
            <ContextMenuItem
              icon={<IconOpenFolder />}
              label={revealInFileManagerLabel()}
              onClick={() => {
                close();
                void revealItem();
              }}
            />
            {item.zone !== "builtin" &&
            !(
              (item.zone === "installed" || item.zone === "linked") &&
              omitRemove
            ) ? (
              <ContextMenuSeparator />
            ) : null}
            {item.zone === "installed" && !omitRemove ? (
              <ContextMenuItem
                icon={<IconDelete />}
                label={t("items.uninstall")}
                className="context-menu__danger"
                onClick={() => {
                  close();
                  setPending("uninstall");
                }}
              />
            ) : null}
            {item.zone === "workshop" ? (
              <ContextMenuItem
                icon={<IconDelete />}
                label={t("items.delete")}
                className="context-menu__danger"
                onClick={() => {
                  close();
                  setPending("delete");
                }}
              />
            ) : null}
            {item.zone === "linked" && !omitRemove ? (
              <ContextMenuItem
                icon={<IconUnlink />}
                label={t("items.unlink")}
                className="context-menu__danger"
                onClick={() => {
                  close();
                  void requestUnlink();
                }}
              />
            ) : null}
          </>
        )}
      </MenuButton>

      <UninstallItemDialog
        open={pending === "uninstall"}
        item={item}
        onClose={() => setPending(null)}
        onAfterRemove={onAfterRemove}
      />

      <AlertConfirmation
        open={pending === "delete"}
        onClose={() => setPending(null)}
        title={t("items.deleteTitle")}
        confirmLabel={t("items.delete")}
        onConfirm={async () =>
          finish(
            await deleteWorkshopItemWithRefresh(item.effectiveId, item.name),
          )
        }
      >
        {t("items.deleteBody", { name: item.name })}
      </AlertConfirmation>

      {resolved != null ? (
        <UnlinkItemDialog
          open={pending === "unlink"}
          item={{ dir: resolved.dir, name: item.name }}
          onClose={() => setPending(null)}
          onAfterRemove={onAfterRemove}
        />
      ) : null}

      {editable ? (
        <ExportItemModal
          open={exportOpen}
          itemId={item.effectiveId}
          onClose={() => setExportOpen(false)}
        />
      ) : null}

      <EditItemModal
        open={editOpen}
        item={resolved}
        saving={saving}
        onClose={() => setEditOpen(false)}
        onSave={(result) => void handleSave(result)}
      />
    </>
  );
}
