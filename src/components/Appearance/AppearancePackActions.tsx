import type { ReactNode } from "react";
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
  return (
    <MenuButton
      ariaLabel={`Actions for ${name}`}
      title="Actions"
      variant="ghost"
    >
      {(close) => {
        const viewPackItem = (
          <ContextMenuItem
            icon={<IconPackage />}
            label="View pack"
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
