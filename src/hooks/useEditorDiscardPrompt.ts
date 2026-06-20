import { useCallback, useState } from "react";

export function useEditorDiscardPrompt(
  hasChanges: boolean,
  onClose: () => void,
) {
  const [discardPrompt, setDiscardPrompt] = useState(false);

  const requestClose = useCallback(() => {
    if (hasChanges) {
      setDiscardPrompt(true);
      return;
    }
    onClose();
  }, [hasChanges, onClose]);

  const handleBackdropClick = useCallback(() => {
    if (discardPrompt) {
      setDiscardPrompt(false);
      return;
    }
    requestClose();
  }, [discardPrompt, requestClose]);

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
