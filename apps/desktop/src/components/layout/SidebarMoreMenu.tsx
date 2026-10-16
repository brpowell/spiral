import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { openAppearanceWindow } from "../../lib/appearanceWindow";
import { useContextMenu } from "../../hooks/useContextMenu";
import { usePackUpdatesStore } from "../../store/usePackUpdatesStore";
import { useUpdaterStore } from "../../store/useUpdaterStore";
import { useWhatsNewStore } from "../../store/useWhatsNewStore";
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
  IconInfo,
  IconMore,
  IconPalette,
  IconRefresh,
} from "../icons";
import { SidebarItem } from "./SidebarItem/SidebarItem";

/** Library sidebar footer overflow menu (Studio, updates). */
export function SidebarMoreMenu() {
  const { t } = useTranslation(["common", "menus"]);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const availableUpdate = useUpdaterStore((s) => s.availableUpdate);
  const status = useUpdaterStore((s) => s.status);
  const checkForUpdates = useUpdaterStore((s) => s.checkForUpdates);
  const installAvailableUpdate = useUpdaterStore(
    (s) => s.installAvailableUpdate,
  );
  const openWhatsNew = useWhatsNewStore((s) => s.openWhatsNew);
  const packUpdatesPending = usePackUpdatesStore(
    (s) => s.pendingUpdates.length > 0,
  );
  const appUpdatePending =
    availableUpdate != null &&
    (status === "available" || status === "downloading" || status === "error");
  const updatePending = appUpdatePending || packUpdatesPending;
  const attentionPending = updatePending;
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

  const moreAria = (() => {
    if (appUpdatePending && packUpdatesPending) {
      return t("common:updates.sidebar.pendingAria");
    }
    if (appUpdatePending) return t("common:updates.sidebar.pendingAppAria");
    if (packUpdatesPending) return t("common:updates.sidebar.pendingPacksAria");
    return t("common:updates.sidebar.more");
  })();

  return (
    <>
      <SidebarItem
        ref={triggerRef}
        leading={
          <StatusIndicatorAnchor className="sidebar-item__icon">
            <IconMore />
            {attentionPending && !open ? <StatusIndicator /> : null}
          </StatusIndicatorAnchor>
        }
        aria-label={moreAria}
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
        <ContextMenuSeparator />
        <ContextMenuItem
          icon={
            <StatusIndicatorAnchor>
              <IconPalette />
              {packUpdatesPending ? <StatusIndicator /> : null}
            </StatusIndicatorAnchor>
          }
          label={t("menus:view.studio")}
          onClick={() => {
            closeMenu();
            void openAppearanceWindow();
          }}
        />
      </ContextMenu>
    </>
  );
}
