import { useCallback } from "react";
import {
  ContextMenu,
  ContextMenuItem,
} from "../components/ContextMenu/ContextMenu";
import { IconEject } from "../components/icons";
import { useCdStore } from "../store/useCdStore";
import type { CdDrive } from "../types/cd";
import { useContextMenu } from "./useContextMenu";

export function useCdDriveMenu(drive: CdDrive) {
  const ejectDrive = useCdStore((s) => s.ejectDrive);
  const isEjecting = useCdStore((s) => s.ejectingDriveIds.has(drive.id));

  const { onContextMenu, closeMenu, open, anchor, position, menuRef } =
    useContextMenu();

  const handleEject = useCallback(() => {
    closeMenu();
    void ejectDrive(drive.id);
  }, [closeMenu, drive.id, ejectDrive]);

  const contextMenu = (
    <ContextMenu
      open={open}
      anchor={anchor}
      position={position}
      menuRef={menuRef}
    >
      <ContextMenuItem
        icon={<IconEject />}
        label={isEjecting ? "Ejecting…" : "Eject Disc"}
        disabled={isEjecting}
        onClick={handleEject}
      />
    </ContextMenu>
  );

  return { onContextMenu, contextMenu, eject: handleEject };
}
