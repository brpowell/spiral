import { useCallback, useState } from "react";

export function useEditorDiscardPrompt(
  hasChanges: boolean,
  onClose: () => void,
  locked = false,
) {
  const [discardPrompt, setDiscardPrompt] = useState(false);

  const requestClose = useCallback(() => {
    if (locked) return;
    if (hasChanges) {
      setDiscardPrompt(true);
      return;
    }
    onClose();
  }, [hasChanges, locked, onClose]);

  const handleBackdropClick = useCallback(() => {
    if (locked) return;
    if (discardPrompt) {
      setDiscardPrompt(false);
      return;
    }
    requestClose();
  }, [discardPrompt, locked, requestClose]);

  const dismissDiscardPrompt = useCallback(() => {
    setDiscardPrompt(false);
  }, []);

  return {
    discardPrompt,
    setDiscardPrompt,
    requestClose,
    handleBackdropClick,
    dismissDiscardPrompt,
  };
}
