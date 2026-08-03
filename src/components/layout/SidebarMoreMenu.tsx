import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { openAppearanceWindow } from "../../lib/appearanceWindow";
import { useContextMenu } from "../../hooks/useContextMenu";
import { useLicenseStore } from "../../store/useLicenseStore";
import { useUpdaterStore } from "../../store/useUpdaterStore";
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuSeparator,
} from "../ContextMenu/ContextMenu";
import {
  StatusIndicator,
  StatusIndicatorAnchor,
} from "../common/StatusIndicator/StatusIndicator";
import {
  IconDownload,
  IconIdCard,
  IconMore,
  IconPalette,
  IconRefresh,
} from "../icons";
import { SidebarItem } from "./SidebarItem/SidebarItem";

/** Library sidebar footer overflow menu (Studio, Spiral Card, updates). */
export function SidebarMoreMenu() {
  const { t } = useTranslation("common");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const openSpiralCard = useLicenseStore((s) => s.openSpiralCard);
  const availableUpdate = useUpdaterStore((s) => s.availableUpdate);
  const status = useUpdaterStore((s) => s.status);
  const checkForUpdates = useUpdaterStore((s) => s.checkForUpdates);
  const promptAvailableUpdate = useUpdaterStore((s) => s.promptAvailableUpdate);
  const updatePending =
    availableUpdate != null &&
    (status === "available" || status === "downloading" || status === "error");
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
        leading={
          <StatusIndicatorAnchor className="sidebar-item__icon">
            <IconMore />
            {updatePending && !open ? <StatusIndicator /> : null}
          </StatusIndicatorAnchor>
        }
        aria-label={
          updatePending
            ? t("updates.sidebar.pendingAria")
            : t("updates.sidebar.more")
        }
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={(e) =>
          toggleFromTrigger(triggerRef.current, { keyboard: e.detail === 0 })
        }
      >
        {t("updates.sidebar.more")}
      </SidebarItem>
      <ContextMenu
        open={open}
        anchor={anchor}
        position={position}
        menuRef={menuRef}
        focusFirstItem={openedWithKeyboard}
      >
        <ContextMenuItem
          icon={
            <StatusIndicatorAnchor>
              {updatePending ? <IconDownload /> : <IconRefresh />}
              {updatePending ? <StatusIndicator /> : null}
            </StatusIndicatorAnchor>
          }
          label={
            updatePending
              ? t("updates.sidebar.available")
              : t("updates.sidebar.check")
          }
          onClick={() => {
            closeMenu();
            if (updatePending) {
              promptAvailableUpdate();
            } else {
              void checkForUpdates({ reason: "manual" });
            }
          }}
        />
        <ContextMenuSeparator />
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
