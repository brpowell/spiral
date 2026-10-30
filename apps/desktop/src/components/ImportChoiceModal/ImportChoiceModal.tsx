import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useLibrarySettingsStore } from "../../store/useLibrarySettingsStore";
import { Checkbox } from "../common/Checkbox/Checkbox";
import { ChoiceList, ChoiceOption } from "../common/ChoiceOption/ChoiceOption";
import {
  Modal,
  ModalBody,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalHeaderMain,
  ModalTitle,
} from "../common/Modal/Modal";

import "./ImportChoiceModal.css";

/** Asks how to add files: copy into the library, or play them where they are. */
export function ImportChoiceModal() {
  const { t } = useTranslation("dialogs");
  const importPrompt = useLibrarySettingsStore((s) => s.importPrompt);
  const confirmImportChoice = useLibrarySettingsStore(
    (s) => s.confirmImportChoice,
  );
  const cancelImportChoice = useLibrarySettingsStore(
    (s) => s.cancelImportChoice,
  );

  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [remember, setRemember] = useState(false);

  const open = importPrompt != null;
  useFocusTrap(panelRef, open);

  const handleChoice = (choice: "copy" | "reference") => {
    void confirmImportChoice(choice, remember).finally(() =>
      setRemember(false),
    );
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
          <ModalTitle id={titleId}>{t("importChoice.title")}</ModalTitle>
          <ModalDescription>{t("importChoice.description")}</ModalDescription>
        </ModalHeaderMain>
      </ModalHeader>

      <ModalBody>
        <ChoiceList className="import-choice-modal__options">
          <li>
            <ChoiceOption
              title={t("importChoice.copyToLibrary")}
              details={t("importChoice.copyToLibraryDescription")}
              onClick={() => handleChoice("copy")}
            />
          </li>
          <li>
            <ChoiceOption
              title={t("importChoice.keepLocation")}
              details={t("importChoice.keepLocationDescription")}
              onClick={() => handleChoice("reference")}
            />
          </li>
        </ChoiceList>
        <Checkbox
          variant="muted"
          checked={remember}
          onChange={(e) => setRemember(e.target.checked)}
        >
          {t("importChoice.dontAskAgain")}
        </Checkbox>
      </ModalBody>

      <ModalFooter onCancel={cancelImportChoice}>{null}</ModalFooter>
    </Modal>
  );
}
