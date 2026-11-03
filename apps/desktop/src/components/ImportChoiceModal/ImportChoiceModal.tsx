import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import {
  describeSourceError,
  isOtherSource,
  sourceDisplayName,
} from "../../lib/sourceAccess";
import {
  addSource,
  getImportSource,
  pickMusicFolder,
  setImportSource,
} from "../../lib/tauri";
import { useLibrarySettingsStore } from "../../store/useLibrarySettingsStore";
import { useSourcesStore } from "../../store/useSourcesStore";
import { Button } from "../common/Button/Button";
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
import { IconPlus } from "../icons";

import "./ImportChoiceModal.css";

/**
 * Asks how to add files: copy into a music folder, or play them where they
 * are. With no folder to copy into, copying stays visible but disabled, with
 * a way to add one; keeping files where they are always works.
 */
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
  const keepRef = useRef<HTMLButtonElement>(null);
  const [remember, setRemember] = useState(false);
  const [destination, setDestination] = useState<number | null>(null);
  /** Whether the import target can take a copy now; null until known. */
  const [copyAvailable, setCopyAvailable] = useState<boolean | null>(null);
  const [addingFolder, setAddingFolder] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const open = importPrompt != null;
  useFocusTrap(panelRef, open);

  useEffect(() => {
    if (!open) {
      setCopyAvailable(null);
      setAddError(null);
      return;
    }
    let cancelled = false;
    void getImportSource()
      .then((target) => {
        if (!cancelled) setCopyAvailable(target.copyAvailable);
      })
      .catch(() => {
        if (!cancelled) setCopyAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  /** Sources a copy can go into: every folder, i.e. all but Other. */
  const destinations = useMemo(
    () => sources.filter((source) => !isOtherSource(source)),
    [sources],
  );
  const reachable = destinations.filter(
    (source) => statuses[source.id] !== "unreachable",
  );
  const importTargetId =
    destinations.find((source) => source.importTarget)?.id ?? null;
  // A copy needs the import target, or another folder picked below.
  const canCopy = copyAvailable === true || reachable.length > 0;
  const showDestination =
    canCopy && (destinations.length > 1 || importTargetId == null);
  const initialDestination =
    copyAvailable !== false && importTargetId != null
      ? importTargetId
      : (reachable[0]?.id ?? null);

  useEffect(() => {
    if (open) setDestination(initialDestination);
  }, [open, initialDestination]);

  // Start on "Keep files where they are" when copying isn't possible.
  useEffect(() => {
    if (open && copyAvailable === false && !canCopy) keepRef.current?.focus();
  }, [open, copyAvailable, canCopy]);

  const handleChoice = (mode: "copy" | "reference") => {
    const sourceId =
      mode === "copy" && showDestination && destination != null
        ? destination
        : undefined;
    void confirmImportChoice({ mode, sourceId }, remember).finally(() =>
      setRemember(false),
    );
  };

  /** Add a folder to copy into; with no import target it becomes the target. */
  const addFolder = async () => {
    if (addingFolder) return;
    setAddingFolder(true);
    setAddError(null);
    try {
      const folder = await pickMusicFolder();
      if (!folder) return;
      let source = await addSource(folder);
      if (importTargetId == null) source = await setImportSource(source.id);
      useSourcesStore.getState().applySource(source);
      await useSourcesStore.getState().loadSources();
      setCopyAvailable((await getImportSource()).copyAvailable);
    } catch (err) {
      setAddError(describeSourceError(err));
    } finally {
      setAddingFolder(false);
    }
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
                !canCopy
                  ? t("importChoice.copyUnavailableDescription")
                  : showDestination
                    ? t("importChoice.copyToSourceDescription")
                    : t("importChoice.copyToLibraryDescription")
              }
              disabled={!canCopy}
              onClick={() => handleChoice("copy")}
            />
            {!canCopy && copyAvailable != null ? (
              <div className="import-choice-modal__enable">
                <p className="import-choice-modal__enable-text">
                  {destinations.length === 0
                    ? t("importChoice.noFolders")
                    : t("importChoice.foldersOffline")}
                </p>
                <Button
                  size="sm"
                  variant="secondary"
                  isLoading={addingFolder}
                  onClick={() => void addFolder()}
                >
                  <IconPlus aria-hidden />
                  {t("importChoice.addFolder")}
                </Button>
              </div>
            ) : null}
            {addError ? (
              <p className="import-choice-modal__error" role="alert">
                {addError}
              </p>
            ) : null}
          </li>
          <li>
            <ChoiceOption
              ref={keepRef}
              title={t("importChoice.keepLocation")}
              details={t("importChoice.keepLocationDescription")}
              onClick={() => handleChoice("reference")}
            />
          </li>
        </ChoiceList>
        {showDestination && destination != null ? (
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
