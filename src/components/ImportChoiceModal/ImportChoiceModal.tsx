import { useId, useRef, useState } from "react";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useLibrarySettingsStore } from "../../store/useLibrarySettingsStore";
import { Button } from "../common/Button/Button";
import {
  Modal,
  ModalBody,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalHeaderMain,
  ModalTitle,
} from "../common/Modal/Modal";

export function ImportChoiceModal() {
  const importPrompt = useLibrarySettingsStore((s) => s.importPrompt);
  const confirmImportChoice = useLibrarySettingsStore((s) => s.confirmImportChoice);
  const cancelImportChoice = useLibrarySettingsStore((s) => s.cancelImportChoice);

  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [remember, setRemember] = useState(false);

  const open = importPrompt != null;
  useFocusTrap(panelRef, open);

  const handleChoice = (choice: "copy" | "reference") => {
    void confirmImportChoice(choice, remember).finally(() => setRemember(false));
  };

  return (
    <Modal
      open={open}
      onClose={cancelImportChoice}
      size="xl"
      panelRef={panelRef}
      labelledBy={titleId}
    >
      <ModalHeader>
        <ModalHeaderMain>
          <ModalTitle id={titleId}>Add to library</ModalTitle>
          <ModalDescription>
            Do you want to copy these files into your Spiral media folder, or
            keep them at their current location?
          </ModalDescription>
        </ModalHeaderMain>
      </ModalHeader>

      <ModalBody>
        <label className="import-choice__remember">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          Don&apos;t ask again
        </label>
      </ModalBody>

      <ModalFooter onCancel={cancelImportChoice}>
        <Button
          variant="secondary"
          onClick={() => handleChoice("reference")}
        >
          Keep original location
        </Button>
        <Button variant="primary" onClick={() => handleChoice("copy")}>
          Copy to library
        </Button>
      </ModalFooter>
    </Modal>
  );
}
