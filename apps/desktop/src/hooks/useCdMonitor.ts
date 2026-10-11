import { useEffect } from "react";
import { useCdStore } from "../store/useCdStore";
import { useNavigationStore } from "../store/useNavigationStore";

/** Subscribe to drive changes and close the CD view if the active disc is ejected. */
export function useCdMonitor(): void {
  const init = useCdStore((s) => s.init);
  const drives = useCdStore((s) => s.drives);
  const cdDriveId = useNavigationStore((s) => s.cdDriveId);
  const closeCdDrive = useNavigationStore((s) => s.closeCdDrive);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    void init().then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  }, [init]);

  useEffect(() => {
    if (cdDriveId == null) return;
    if (drives.some((drive) => drive.id === cdDriveId)) return;
    // Store already verified eject before removing the drive from the list.
    closeCdDrive();
  }, [cdDriveId, closeCdDrive, drives]);
}
