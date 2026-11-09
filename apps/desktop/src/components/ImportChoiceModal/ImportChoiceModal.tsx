import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { describeSourceError, sourceDisplayName } from "@/lib/sourceAccess";
import { addSource, pickMusicFolder, setImportSource } from "@/lib/tauri";
import { useLibrarySettingsStore } from "@/store/useLibrarySettingsStore";
import { useSourcesStore } from "@/store/useSourcesStore";
import { Button } from "@/components/common/Button/Button";
import { FormField } from "@/components/common/Field/Field";
import {
  Modal,
  ModalBody,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalHeaderMain,
  ModalTitle,
} from "@/components/common/Modal/Modal";
import { Select } from "@/components/common/Select/Select";
import { IconPlus } from "@/components/icons";

import "./ImportChoiceModal.css";

/**
 * Asks where to copy files when the import target can't take them: its folder
 * is offline, or (defensively) none is set, and then the folder picked becomes
 * it. With every folder offline, the picker is disabled until one is added.
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
  const [destination, setDestination] = useState<number | null>(null);
  const [addingFolder, setAddingFolder] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const open = importPrompt != null;
  useFocusTrap(panelRef, open);

  const reachable = sources.filter(
    (source) => statuses[source.id] !== "unreachable",
  );
  const importTargetId =
    sources.find((source) => source.importTarget)?.id ?? null;
  const initialDestination =
    reachable.find((source) => source.id === importTargetId)?.id ??
    reachable[0]?.id ??
    null;

  // Statuses otherwise only refresh while Preferences is open.
  useEffect(() => {
    if (open) void useSourcesStore.getState().loadStatuses();
  }, [open]);

  useEffect(() => {
    if (open) {
      setDestination(initialDestination);
    } else {
      setAddError(null);
    }
  }, [open, initialDestination]);

  /** Copy into the picked folder; with no import target, it becomes one. */
  const confirm = async () => {
    if (destination == null || confirming) return;
    setConfirming(true);
    try {
      if (importTargetId == null) {
        try {
          useSourcesStore
            .getState()
            .applySource(await setImportSource(destination));
          await useSourcesStore.getState().loadSources();
        } catch (err) {
          console.error("setImportSource failed:", err);
        }
      }
      await confirmImportChoice(destination);
    } finally {
      setConfirming(false);
    }
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
      setDestination(source.id);
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
      size="lg"
      panelRef={panelRef}
      labelledBy={titleId}
    >
      <ModalHeader>
        <ModalHeaderMain>
          <ModalTitle id={titleId}>{t("importChoice.title")}</ModalTitle>
          <ModalDescription>
            {reachable.length > 0
              ? t("importChoice.descriptionChoose")
              : t("importChoice.descriptionAdd")}
          </ModalDescription>
        </ModalHeaderMain>
      </ModalHeader>

      <ModalBody>
        <FormField label={t("importChoice.destination")}>
          <div className="import-choice-modal__destination">
            <Select
              aria-label={t("importChoice.destination")}
              value={String(destination ?? importTargetId)}
              onChange={(value) => setDestination(Number(value))}
              disabled={reachable.length === 0}
              options={sources.map((source) => ({
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
            <Button
              size="sm"
              variant="secondary"
              isLoading={addingFolder}
              loadingLabel={t("importChoice.adding")}
              onClick={() => void addFolder()}
            >
              <IconPlus aria-hidden />
              {t("importChoice.addFolder")}
            </Button>
          </div>
        </FormField>
        {addError ? (
          <p className="import-choice-modal__error" role="alert">
            {addError}
          </p>
        ) : null}
      </ModalBody>

      <ModalFooter onCancel={cancelImportChoice}>
        <Button
          variant="primary"
          disabled={destination == null}
          isLoading={confirming}
          onClick={() => void confirm()}
        >
          {t("importChoice.copy")}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
