import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ContextMenuItem } from "../ContextMenu/ContextMenu";
import { IconPackage } from "../icons";
import { MenuButton } from "../MenuButton/MenuButton";

export function AppearancePackActions({
  name,
  packId,
  onOpenPack,
  children,
}: {
  name: string;
  packId: string;
  onOpenPack: (packId: string) => void;
  /**
   * Custom menu contents. Receives a ready-made “View pack” item so callers
   * can place it (e.g. below Edit). When omitted, the menu is just View pack.
   */
  children?: (close: () => void, viewPackItem: ReactNode) => ReactNode;
}) {
  const { t } = useTranslation(["studio", "common"]);
  return (
    <MenuButton
      ariaLabel={t("packs.cardActionsAria", { name })}
      title={t("common:actions")}
      variant="ghost"
    >
      {(close) => {
        const viewPackItem = (
          <ContextMenuItem
            icon={<IconPackage />}
            label={t("viewPack")}
            onClick={() => {
              close();
              onOpenPack(packId);
            }}
          />
        );

        if (children) {
          return children(close, viewPackItem);
        }

        return viewPackItem;
      }}
    </MenuButton>
  );
}
