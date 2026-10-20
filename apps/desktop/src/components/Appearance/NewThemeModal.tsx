import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { defaultNewItemLocation, pickNewItemFolder } from "../../lib/tauri";
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
import { TextInput } from "../common/TextInput/TextInput";
import "./NewThemeModal.css";

export interface NewThemeModalResult {
  name: string;
  /** Folder for the new theme; omitted to use the default under the Spiral Library. */
  location?: string;
}

interface NewThemeModalProps {
  open: boolean;
  creating: boolean;
  onClose: () => void;
  onCreate: (result: NewThemeModalResult) => void;
}

export function NewThemeModal({
  open,
  creating,
  onClose,
  onCreate,
}: NewThemeModalProps) {
  const { t } = useTranslation(["studio", "common"]);
  const titleId = useId();
  const [themeName, setThemeName] = useState("");
  const [location, setLocation] = useState("");
  // Once the user edits or picks a location it stops following the name.
  const [locationEdited, setLocationEdited] = useState(false);
  const locationRequest = useRef(0);

  useEffect(() => {
    if (!open) return;
    setThemeName("");
    setLocation("");
    setLocationEdited(false);
  }, [open]);

  useEffect(() => {
    if (!open || locationEdited) return;
    const request = ++locationRequest.current;
    void defaultNewItemLocation("theme", themeName.trim())
      .then((dir) => {
        if (request === locationRequest.current) setLocation(dir);
      })
      .catch(() => {
        /* The backend picks the default when no location is sent. */
      });
  }, [open, themeName, locationEdited]);

  const setEditedLocation = (value: string) => {
    // Drop any default still being fetched so it cannot overwrite this.
    locationRequest.current++;
    setLocation(value);
    setLocationEdited(true);
  };

  const trimmedName = themeName.trim();
  const trimmedLocation = location.trim();
  const canSubmit = trimmedName.length > 0 && !creating;

  const handleSubmit = () => {
    if (!canSubmit) return;
    onCreate({
      name: trimmedName,
      location:
        locationEdited && trimmedLocation.length > 0
          ? trimmedLocation
          : undefined,
    });
  };

  const handleBrowse = async () => {
    const picked = await pickNewItemFolder(trimmedLocation || undefined);
    if (picked == null) return;
    // The picked folder is the parent; the theme gets its own folder inside it.
    const separator =
      picked.includes("\\") && !picked.includes("/") ? "\\" : "/";
    const slug = location.split(/[\\/]/).filter(Boolean).pop() ?? "theme";
    setEditedLocation(picked.replace(/[\\/]+$/, "") + separator + slug);
  };

  return (
    <Modal
      open={open}
      onClose={() => !creating && onClose()}
      size="sm"
      labelledBy={titleId}
    >
      <ModalHeader>
        <ModalHeaderMain>
          <ModalTitle id={titleId}>{t("themes.newTitle")}</ModalTitle>
        </ModalHeaderMain>
      </ModalHeader>
      <ModalBody>
        <FormField label={t("common:name")}>
          <TextInput
            value={themeName}
            onChange={(e) => setThemeName(e.target.value)}
            placeholder={t("themes.namePlaceholder")}
            autoFocus
            disabled={creating}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleSubmit();
              }
            }}
          />
        </FormField>
        <FormField
          label={t("themes.locationLabel")}
          className="new-theme-modal__location"
        >
          <div className="new-theme-modal__location-row">
            <TextInput
              value={location}
              onChange={(e) => setEditedLocation(e.target.value)}
              disabled={creating}
              spellCheck={false}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
            />
            <Button
              variant="secondary"
              size="sm"
              disabled={creating}
              onClick={() => void handleBrowse()}
            >
              {t("themes.browseLocation")}
            </Button>
          </div>
        </FormField>
      </ModalBody>
      <ModalFooter onCancel={onClose} cancelDisabled={creating}>
        <Button variant="primary" disabled={!canSubmit} onClick={handleSubmit}>
          {creating ? t("common:creating") : t("common:create")}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
