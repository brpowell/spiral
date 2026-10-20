import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { TagWriteWarningDialog } from "../components/TagWriteWarningDialog/TagWriteWarningDialog";
import {
  dismissTagWriteWarning,
  isTagWriteWarningDismissed,
} from "../lib/tagWriteWarningPreferences";

/**
 * Gate for actions that write metadata tags into the user's audio files.
 * Runs `action` immediately once the warning has been dismissed for good;
 * otherwise shows the dialog first and runs it on confirm.
 */
export function useTagWriteWarning() {
  const [open, setOpen] = useState(false);
  const pendingRef = useRef<(() => void | Promise<void>) | null>(null);

  const requestTagWrite = useCallback((action: () => void | Promise<void>) => {
    if (isTagWriteWarningDismissed()) {
      void action();
      return;
    }
    pendingRef.current = action;
    setOpen(true);
  }, []);

  const handleClose = useCallback(() => {
    setOpen(false);
  }, []);

  const handleConfirm = useCallback(async (dontShowAgain: boolean) => {
    if (dontShowAgain) dismissTagWriteWarning();
    const action = pendingRef.current;
    pendingRef.current = null;
    await action?.();
  }, []);

  const tagWriteDialog = createPortal(
    <TagWriteWarningDialog
      open={open}
      onClose={handleClose}
      onConfirm={handleConfirm}
    />,
    document.body,
  );

  return { requestTagWrite, tagWriteDialog };
}
