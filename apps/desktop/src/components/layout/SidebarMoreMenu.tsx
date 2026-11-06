import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { useContextMenu } from "../../hooks/useContextMenu";
import { useUpdaterStore } from "../../store/useUpdaterStore";
import { useWhatsNewStore } from "../../store/useWhatsNewStore";
import { ContextMenu, ContextMenuItem } from "../ContextMenu/ContextMenu";
import {
  StatusIndicator,
  StatusIndicatorAnchor,
} from "../common/StatusIndicator/StatusIndicator";
import { IconDownload, IconInfo, IconMore, IconRefresh } from "../icons";
import { SidebarItem } from "./SidebarItem/SidebarItem";

/** Library sidebar footer overflow menu (app updates, What's New). */
export function SidebarMoreMenu() {
  const { t } = useTranslation("common");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const availableUpdate = useUpdaterStore((s) => s.availableUpdate);
  const status = useUpdaterStore((s) => s.status);
  const checkForUpdates = useUpdaterStore((s) => s.checkForUpdates);
  const installAvailableUpdate = useUpdaterStore(
    (s) => s.installAvailableUpdate,
  );
  const openWhatsNew = useWhatsNewStore((s) => s.openWhatsNew);
  const appUpdatePending =
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
            {appUpdatePending && !open ? <StatusIndicator /> : null}
          </StatusIndicatorAnchor>
        }
        aria-label={
          appUpdatePending
            ? t("common:updates.sidebar.pendingAppAria")
            : t("common:updates.sidebar.more")
        }
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={(e) =>
          toggleFromTrigger(triggerRef.current, { keyboard: e.detail === 0 })
        }
      >
        {t("common:updates.sidebar.more")}
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
              {appUpdatePending ? <IconDownload /> : <IconRefresh />}
              {appUpdatePending ? <StatusIndicator /> : null}
            </StatusIndicatorAnchor>
          }
          label={
            appUpdatePending
              ? t("common:updates.sidebar.available")
              : t("common:updates.sidebar.check")
          }
          onClick={() => {
            closeMenu();
            if (appUpdatePending) {
              void installAvailableUpdate();
            } else {
              void checkForUpdates({ reason: "manual" });
            }
          }}
        />
        <ContextMenuItem
          icon={<IconInfo />}
          label={t("common:updates.menu.whatsNew")}
          onClick={() => {
            closeMenu();
            openWhatsNew();
          }}
        />
      </ContextMenu>
    </>
  );
}
