import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { exportItemWithToast } from "../../lib/items/itemActions";
import { isPackSemver } from "../../lib/packs/packManifest";
import { getItemExportDefaults } from "../../lib/tauri";
import { Button } from "../common/Button/Button";
import { FormField } from "../common/Field/Field";
import {
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalHeaderMain,
  ModalTitle,
} from "../common/Modal/Modal";
import { Textarea } from "../common/Textarea/Textarea";
import { TextInput } from "../common/TextInput/TextInput";

type LoadState = "loading" | "ready" | "error";

/** Collects the release metadata for an authoring item, then saves it as a `.spk`. */
export function ExportItemModal({
  open,
  itemId,
  onClose,
}: {
  open: boolean;
  itemId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation(["studio", "common"]);
  const titleId = useId();
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [name, setName] = useState("");
  const [version, setVersion] = useState("");
  const [description, setDescription] = useState("");
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadState("loading");
    void getItemExportDefaults(itemId)
      .then((defaults) => {
        if (cancelled) return;
        setName(defaults.name);
        setVersion(defaults.version);
        setDescription(defaults.description);
        setLoadState("ready");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.error("Failed to load export defaults:", err);
        setLoadState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [open, itemId]);

  const trimmedVersion = version.trim();
  const versionValid = isPackSemver(trimmedVersion);
  const canSubmit =
    loadState === "ready" &&
    name.trim().length > 0 &&
    versionValid &&
    !exporting;

  const handleExport = async () => {
    if (!canSubmit) return;
    setExporting(true);
    try {
      const result = await exportItemWithToast(itemId, {
        name: name.trim(),
        version: trimmedVersion,
        description: description.trim(),
      });
      // A cancelled save dialog returns null: stay open so they can try again.
      if (result) onClose();
    } finally {
      setExporting(false);
    }
  };

  const submitOnEnter = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void handleExport();
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => !exporting && onClose()}
      size="sm"
      labelledBy={titleId}
    >
      <ModalHeader>
        <ModalHeaderMain>
          <ModalTitle id={titleId}>{t("items.exportTitle")}</ModalTitle>
        </ModalHeaderMain>
      </ModalHeader>
      <ModalBody>
        {loadState === "error" ? (
          <p role="alert">{t("items.exportLoadFailed")}</p>
        ) : (
          <>
            <FormField label={t("common:name")}>
              <TextInput
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={loadState !== "ready" || exporting}
                autoFocus
                onKeyDown={submitOnEnter}
              />
            </FormField>
            <FormField
              label={t("items.version")}
              description={
                version.length > 0 && !versionValid
                  ? t("items.versionInvalid")
                  : t("items.versionHint")
              }
            >
              <TextInput
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                placeholder={t("items.versionPlaceholder")}
                disabled={loadState !== "ready" || exporting}
                spellCheck={false}
                autoComplete="off"
                onKeyDown={submitOnEnter}
              />
            </FormField>
            <FormField label={t("common:description")}>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t("items.descriptionPlaceholder")}
                rows={2}
                disabled={loadState !== "ready" || exporting}
                autoSize
              />
            </FormField>
            <p className="appearance-section__status">
              {t("items.exportHint")}
            </p>
          </>
        )}
      </ModalBody>
      <ModalFooter onCancel={onClose} cancelDisabled={exporting}>
        <Button
          variant="primary"
          disabled={!canSubmit}
          onClick={() => void handleExport()}
        >
          {exporting ? t("items.exporting") : t("items.exportAction")}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
