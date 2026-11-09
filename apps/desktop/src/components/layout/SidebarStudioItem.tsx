import { useTranslation } from "react-i18next";
import { openAppearanceWindow } from "@/lib/windows/appearanceWindow";
import { useItemUpdatesStore } from "@/store/useItemUpdatesStore";
import {
  StatusIndicator,
  StatusIndicatorAnchor,
} from "@/components/common/StatusIndicator/StatusIndicator";
import { IconPalette } from "@/components/icons";
import { SidebarItem } from "./SidebarItem/SidebarItem";

/** Library sidebar row that opens the Studio window. */
export function SidebarStudioItem() {
  const { t } = useTranslation(["common", "menus"]);
  const itemUpdatesPending = useItemUpdatesStore(
    (s) => s.pendingUpdates.length > 0,
  );

  return (
    <SidebarItem
      leading={
        <StatusIndicatorAnchor className="sidebar-item__icon">
          <IconPalette />
          {itemUpdatesPending ? <StatusIndicator /> : null}
        </StatusIndicatorAnchor>
      }
      aria-label={
        itemUpdatesPending
          ? t("common:updates.sidebar.studioPendingAria")
          : undefined
      }
      onClick={() => void openAppearanceWindow()}
    >
      {t("menus:view.studio")}
    </SidebarItem>
  );
}
