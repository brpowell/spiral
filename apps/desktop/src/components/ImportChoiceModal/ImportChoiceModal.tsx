import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { sourceDisplayName, sourceRole } from "../../lib/sourceAccess";
import { useLibrarySettingsStore } from "../../store/useLibrarySettingsStore";
import { useSourcesStore } from "../../store/useSourcesStore";
import { Checkbox } from "../common/Checkbox/Checkbox";
import { ChoiceList, ChoiceOption } from "../common/ChoiceOption/ChoiceOption";
import { FormField } from "../common/Field/Field";
import { NativeSelect } from "../common/NativeSelect/NativeSelect";
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

  const sources = useSourcesStore((s) => s.sources);
  const statuses = useSourcesStore((s) => s.statuses);

  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [remember, setRemember] = useState(false);
  const [destination, setDestination] = useState<number | null>(null);

  const open = importPrompt != null;
  useFocusTrap(panelRef, open);

  /** Sources a copy can go into: every one with a folder, i.e. all but Other. */
  const destinations = useMemo(
    () => sources.filter((source) => sourceRole(source) !== "other"),
    [sources],
  );
  const importTargetId =
    destinations.find((source) => source.importTarget)?.id ??
    destinations[0]?.id ??
    null;

  useEffect(() => {
    if (open) setDestination(importTargetId);
  }, [open, importTargetId]);

  const handleChoice = (mode: "copy" | "reference") => {
    const sourceId =
      mode === "copy" && destinations.length > 1 && destination != null
        ? destination
        : undefined;
    void confirmImportChoice({ mode, sourceId }, remember).finally(() =>
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
              details={
                destinations.length > 1
                  ? t("importChoice.copyToSourceDescription")
                  : t("importChoice.copyToLibraryDescription")
              }
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
        {destinations.length > 1 && destination != null ? (
          <FormField
            className="import-choice-modal__destination"
            label={t("importChoice.destination")}
            description={t("importChoice.destinationDescription")}
          >
            <NativeSelect
              aria-label={t("importChoice.destination")}
              value={String(destination)}
              onChange={(value) => setDestination(Number(value))}
              options={destinations.map((source) => ({
                value: String(source.id),
                label:
                  statuses[source.id] === "unreachable"
                    ? t("importChoice.destinationOffline", {
                        name: sourceDisplayName(source),
                      })
                    : sourceDisplayName(source),
                disabled: statuses[source.id] === "unreachable",
              }))}
            />
          </FormField>
        ) : null}
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
