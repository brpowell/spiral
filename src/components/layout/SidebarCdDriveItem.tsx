import { SidebarItem } from "./SidebarItem/SidebarItem";
import { IconDisc } from "../icons";
import { useCdDriveMenu } from "../../hooks/useCdDriveMenu";
import { cdSidebarDiscLabel } from "../../lib/cdTracks";
import { useCdStore } from "../../store/useCdStore";
import { useNavigationStore } from "../../store/useNavigationStore";
import type { CdDrive } from "../../types/cd";

interface SidebarCdDriveItemProps {
  drive: CdDrive;
}

export function SidebarCdDriveItem({ drive }: SidebarCdDriveItemProps) {
  const cdDriveId = useNavigationStore((s) => s.cdDriveId);
  const openCdDrive = useNavigationStore((s) => s.openCdDrive);
  const disc = useCdStore((s) => s.discsByDriveId[drive.id]);
  const isActive = cdDriveId === drive.id;
  const { onContextMenu, contextMenu } = useCdDriveMenu(drive);

  return (
    <li>
      <SidebarItem
        icon={<IconDisc />}
        active={isActive}
        onClick={() => openCdDrive(drive.id)}
        onContextMenu={onContextMenu}
      >
        {cdSidebarDiscLabel(disc)}
      </SidebarItem>
      {contextMenu}
    </li>
  );
}
