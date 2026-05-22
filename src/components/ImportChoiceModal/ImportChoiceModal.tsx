import { useId, useRef, useState } from "react";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useLibrarySettingsStore } from "../../store/useLibrarySettingsStore";
import { AnimatedModal } from "../AnimatedModal/AnimatedModal";
import { Button } from "../Button/Button";
import { ModalFooter } from "../ModalFooter/ModalFooter";
import "./ImportChoiceModal.css";

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
    <AnimatedModal
      open={open}
      backdropClassName="import-choice-backdrop"
      panelClassName="import-choice"
      panelRef={panelRef}
      labelledBy={titleId}
      onBackdropClick={cancelImportChoice}
    >
      <div className="import-choice__body">
        <h2 id={titleId} className="import-choice__title">
          Add to library
        </h2>
        <p className="import-choice__hint">
          Do you want to copy these files into your Spiral media folder, or keep
          them at their current location?
        </p>

        <label className="import-choice__remember">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          Don&apos;t ask again
        </label>
      </div>

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
    </AnimatedModal>
  );
}
