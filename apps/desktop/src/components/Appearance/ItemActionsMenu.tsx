import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  deleteWorkshopItemWithRefresh,
  setItemHiddenWithRefresh,
  uninstallItemWithRefresh,
  unlinkItemWithRefresh,
  updateItemMetadataWithRefresh,
} from "../../lib/items/itemActions";
import {
  collectClearableSkinSettings,
  type ClearableSkinSetting,
} from "../../lib/packs/packSkinSettings";
import { listItems } from "../../lib/tauri";
import type { ItemSummary, ItemType } from "../../types/item";
import type { PackZone } from "../../types/pack";
import { AlertConfirmation } from "../common/AlertConfirmation/AlertConfirmation";
import { Checkbox } from "../common/Checkbox/Checkbox";
import {
  ContextMenuItem,
  ContextMenuSeparator,
} from "../ContextMenu/ContextMenu";
import {
  IconDelete,
  IconHide,
  IconPackage,
  IconPencil,
  IconUnlink,
} from "../icons";
import { MenuButton } from "../MenuButton/MenuButton";
import { useOpenAppearanceThemeEditor } from "./AppearanceThemeEditorContext";
import { EditItemModal, type EditItemModalResult } from "./EditItemModal";

/** The few fields every list source (stores, `listItems`) can provide for an item. */
export interface ItemRef {
  effectiveId: string;
  type: ItemType;
  name: string;
  zone: PackZone;
  hidden?: boolean;
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
  extra,
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
  /** Extra menu entries placed before the destructive section. */
  extra?: (close: () => void) => React.ReactNode;
}) {
  const { t } = useTranslation(["studio", "common"]);
  const openThemeEditor = useOpenAppearanceThemeEditor();
  const [pending, setPending] = useState<PendingAction>(null);
  const [resolved, setResolved] = useState<ItemSummary | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [clearable, setClearable] = useState<ClearableSkinSetting[]>([]);
  const [clearSettings, setClearSettings] = useState(false);

  const editable = item.zone === "workshop" || item.zone === "linked";
  const canHide = item.zone === "builtin" || item.zone === "installed";

  useEffect(() => {
    if (pending !== "uninstall" || item.type !== "skin") {
      setClearable([]);
      setClearSettings(false);
      return;
    }
    let cancelled = false;
    void collectClearableSkinSettings([item.effectiveId]).then((entries) => {
      if (!cancelled) setClearable(entries);
    });
    return () => {
      cancelled = true;
    };
  }, [pending, item.type, item.effectiveId]);

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
            {editable && item.type === "theme" ? (
              <ContextMenuItem
                icon={<IconPencil />}
                label={t("common:edit")}
                onClick={() => {
                  close();
                  openThemeEditor(item.effectiveId);
                }}
              />
            ) : null}
            {editable ? (
              <ContextMenuItem
                icon={<IconPencil />}
                label={t("items.editDetails")}
                onClick={() => {
                  close();
                  void openEdit();
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
            {canHide ? (
              <ContextMenuItem
                icon={<IconHide />}
                label={item.hidden ? t("common:show") : t("common:hide")}
                onClick={() => {
                  close();
                  void setItemHiddenWithRefresh(item.effectiveId, !item.hidden);
                }}
              />
            ) : null}
            {extra?.(close)}
            {item.zone !== "builtin" ? <ContextMenuSeparator /> : null}
            {item.zone === "installed" ? (
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
            {item.zone === "linked" ? (
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

      <AlertConfirmation
        open={pending === "uninstall"}
        onClose={() => setPending(null)}
        title={t("items.uninstallTitle")}
        confirmLabel={t("items.uninstall")}
        onConfirm={async () =>
          finish(
            await uninstallItemWithRefresh(
              item.effectiveId,
              item.name,
              clearSettings ? clearable : [],
            ),
          )
        }
      >
        <p>{t("items.uninstallBody", { name: item.name })}</p>
        {clearable.length > 0 ? (
          <Checkbox
            className="alert-confirmation__option"
            checked={clearSettings}
            onChange={(event) => setClearSettings(event.target.checked)}
          >
            {t("catalog.uninstallClearSettings")}
          </Checkbox>
        ) : null}
      </AlertConfirmation>

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

      <AlertConfirmation
        open={pending === "unlink"}
        onClose={() => setPending(null)}
        title={t("items.unlinkTitle")}
        confirmLabel={t("items.unlink")}
        onConfirm={async () =>
          finish(
            resolved != null &&
              (await unlinkItemWithRefresh(resolved.dir, item.name)),
          )
        }
      >
        {t("items.unlinkBody", { name: item.name })}
      </AlertConfirmation>

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
