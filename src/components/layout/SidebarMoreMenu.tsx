import { useRef } from "react";
import { openAppearanceWindow } from "../../lib/appearanceWindow";
import { useContextMenu } from "../../hooks/useContextMenu";
import { useLicenseStore } from "../../store/useLicenseStore";
import { ContextMenu, ContextMenuItem } from "../ContextMenu/ContextMenu";
import { IconIdCard, IconMore, IconPalette } from "../icons";
import { SidebarItem } from "./SidebarItem/SidebarItem";

/** Library sidebar footer overflow menu (Studio, Spiral Card, …). */
export function SidebarMoreMenu() {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const openSpiralCard = useLicenseStore((s) => s.openSpiralCard);
  const {
    open,
    anchor,
    position,
    menuRef,
    openedWithKeyboard,
    toggleFromTrigger,
    closeMenu,
  } = useContextMenu({
    dismissExcludeRefs: [triggerRef],
    triggerPlacement: "above-start",
  });

  return (
    <>
      <SidebarItem
        ref={triggerRef}
        icon={<IconMore />}
        aria-label="More"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={(e) =>
          toggleFromTrigger(triggerRef.current, { keyboard: e.detail === 0 })
        }
      >
        More
      </SidebarItem>
      <ContextMenu
        open={open}
        anchor={anchor}
        position={position}
        menuRef={menuRef}
        focusFirstItem={openedWithKeyboard}
      >
        <ContextMenuItem
          icon={<IconPalette />}
          label="Studio"
          onClick={() => {
            closeMenu();
            void openAppearanceWindow();
          }}
        />
        <ContextMenuItem
          icon={<IconIdCard />}
          label="Spiral Card"
          onClick={() => {
            closeMenu();
            openSpiralCard();
          }}
        />
      </ContextMenu>
    </>
  );
}
