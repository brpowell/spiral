import { useMemo } from "react";
import { SidebarItem } from "./SidebarItem/SidebarItem";
import { Button } from "../common/Button/Button";
import { ImportIndicator } from "../ImportIndicator/ImportIndicator";
import { IconDisc, IconEject } from "../icons";
import { useCdDriveMenu } from "../../hooks/useCdDriveMenu";
import { mergeRemoteMetadataIntoDisc } from "../../lib/cdMetadata";
import { cdSidebarDiscLabel } from "../../lib/cdTracks";
import { t } from "../../lib/i18n";
import { useCdImportStore } from "../../store/useCdImportStore";
import { useCdStore } from "../../store/useCdStore";
import { useNavigationStore } from "../../store/useNavigationStore";
import type { CdDrive } from "../../types/cd";
import "./SidebarCdDriveItem.css";

interface SidebarCdDriveItemProps {
  drive: CdDrive;
}

export function SidebarCdDriveItem({ drive }: SidebarCdDriveItemProps) {
  const cdDriveId = useNavigationStore((s) => s.cdDriveId);
  const openCdDrive = useNavigationStore((s) => s.openCdDrive);
  const disc = useCdStore((s) => s.discsByDriveId[drive.id]);
  const metadata = useCdStore((s) => s.metadataByDriveId[drive.id]);
  const displayDisc = useMemo(() => {
    if (disc == null || metadata == null) return disc;
    return mergeRemoteMetadataIntoDisc(disc, metadata);
  }, [disc, metadata]);
  const isActive = cdDriveId === drive.id;
  const isEjecting = useCdStore((s) => s.ejectingDriveIds.has(drive.id));
  const isImporting = useCdImportStore((s) => s.importingDriveId === drive.id);
  const { onContextMenu, contextMenu, eject } = useCdDriveMenu(drive);

  return (
    <li className="sidebar-cd-drive-item">
      <SidebarItem
        icon={isImporting ? <ImportIndicator inline /> : <IconDisc />}
        active={isActive}
        aria-busy={isImporting || undefined}
        onClick={() => openCdDrive(drive.id)}
        onContextMenu={onContextMenu}
      >
        {cdSidebarDiscLabel(displayDisc)}
      </SidebarItem>
      <Button
        variant="ghost"
        size="sm"
        iconOnly
        className="sidebar-cd-drive-item__eject"
        aria-label={
          isEjecting
            ? t("library:cd.actions.ejectingDiscAria")
            : t("library:cd.actions.ejectDiscAria")
        }
        disabled={isEjecting}
        onClick={(event) => {
          event.stopPropagation();
          eject();
        }}
      >
        <IconEject />
      </Button>
      {contextMenu}
    </li>
  );
}
