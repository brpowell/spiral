import { useState } from "react";
import { listPacks } from "../../lib/tauri";
import { themeDeletedPayload } from "../../lib/toastPayloads";
import { useBackgroundTasksStore } from "../../store/useBackgroundTasksStore";
import { useThemeStore } from "../../store/useThemeStore";
import { isAuthoringPackZone } from "../../types/pack";
import type { Theme } from "../../types/theme";
import { AppearancePackActions } from "../Appearance/AppearancePackActions";
import { useOpenAppearanceThemeEditor } from "../Appearance/AppearanceThemeEditorContext";
import { AlertConfirmation } from "../common/AlertConfirmation/AlertConfirmation";
import {
  ContextMenuItem,
  ContextMenuSeparator,
} from "../ContextMenu/ContextMenu";
import { IconDelete, IconPencil } from "../icons";

export function WorkshopThemeActions({
  theme,
  onOpenPack,
}: {
  theme: Theme;
  onOpenPack: (packId: string) => void;
}) {
  const deleteTheme = useThemeStore((s) => s.deleteTheme);
  const showToast = useBackgroundTasksStore((s) => s.showToast);
  const openThemeEditor = useOpenAppearanceThemeEditor();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isLastContribution, setIsLastContribution] = useState(false);

  if (!theme.mutable || !theme.packId) return null;

  const openDelete = async () => {
    setDeleteOpen(true);
    try {
      const packs = await listPacks();
      const pack = packs.find(
        (p) => isAuthoringPackZone(p.zone) && p.packId === theme.packId,
      );
      setIsLastContribution((pack?.contributions.length ?? 1) <= 1);
    } catch {
      // Fall back to pack-removal wording if we can't inspect the pack.
      setIsLastContribution(true);
    }
  };

  const packLabel = theme.packName || theme.packId;
  const deleteMessage = isLastContribution
    ? theme.zone === "linked"
      ? `This removes “${theme.name}” from the linked pack “${packLabel}”. The folder on disk is left in place. This cannot be undone.`
      : `This removes “${theme.name}” and deletes the workshop pack “${packLabel}” from disk. This cannot be undone.`
    : `This removes “${theme.name}” from the pack “${packLabel}”. This cannot be undone.`;

  return (
    <>
      <AppearancePackActions
        name={theme.name}
        packId={theme.packId}
        onOpenPack={onOpenPack}
      >
        {(close, viewPackItem) => (
          <>
            <ContextMenuItem
              icon={<IconPencil />}
              label="Edit"
              onClick={() => {
                close();
                openThemeEditor(theme.id);
              }}
            />
            {viewPackItem}
            <ContextMenuSeparator />
            <ContextMenuItem
              icon={<IconDelete />}
              label="Delete"
              className="context-menu__danger"
              onClick={() => {
                close();
                void openDelete();
              }}
            />
          </>
        )}
      </AppearancePackActions>

      <AlertConfirmation
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Delete theme?"
        confirmLabel="Delete"
        onConfirm={async () => {
          await deleteTheme(theme.id);
          showToast(themeDeletedPayload());
        }}
      >
        {deleteMessage}
      </AlertConfirmation>
    </>
  );
}
