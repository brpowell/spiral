import { useState } from "react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation(["studio", "common"]);
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
      ? t("themes.deleteLinkedLast", { name: theme.name, pack: packLabel })
      : t("themes.deleteWorkshopLast", { name: theme.name, pack: packLabel })
    : t("themes.deleteFromPack", { name: theme.name, pack: packLabel });

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
              label={t("common:edit")}
              onClick={() => {
                close();
                openThemeEditor(theme.id);
              }}
            />
            {viewPackItem}
            <ContextMenuSeparator />
            <ContextMenuItem
              icon={<IconDelete />}
              label={t("common:delete")}
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
        title={t("themes.deleteTitle")}
        confirmLabel={t("common:delete")}
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
