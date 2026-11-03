import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { describeSourceError, sourceDisplayName } from "../../lib/sourceAccess";
import { pickMusicFolder } from "../../lib/tauri";
import type { Source } from "../../types/source";
import { Button } from "../common/Button/Button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "../common/Field/Field";
import {
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from "../common/Modal/Modal";
import { Switch } from "../common/Switch/Switch";
import { TextInput } from "../common/TextInput/TextInput";
import { IconOpenFolder } from "../icons";
import "./SourceEditDialog.css";

/** A path format field's value as stored: blank means the default format. */
export function normalizeFormat(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** What the user changed in the dialog; unset fields stay as they were. */
export interface SourceEdits {
  /** A new folder for the source. */
  rootPath?: string;
  /** Make the source the default folder copies go into. */
  makeDefault?: boolean;
  autoOrganize?: boolean;
  /** The source's own format; null goes back to the default one. */
  pathFormat?: string | null;
}

interface SourceEditDialogProps {
  source: Source | null;
  /** Whether the source's folder can't be reached right now. */
  offline: boolean;
  /** The global path format a source without its own uses. */
  defaultFormat: string;
  onClose: () => void;
  /** Applies the edits. Throwing keeps the dialog open with the error. */
  onSave: (source: Source, edits: SourceEdits) => Promise<void>;
}

/**
 * Edit a source: its location, whether it's the default folder, and how
 * Spiral organizes it. Nothing changes until Save.
 */
export function SourceEditDialog({
  source: requested,
  offline,
  defaultFormat,
  onClose,
  onSave,
}: SourceEditDialogProps) {
  const { t } = useTranslation(["preferences", "common"]);
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const open = requested != null;
  // Keep showing the last source while the dialog animates closed.
  const [shown, setShown] = useState<Source | null>(requested);
  if (requested && requested !== shown) setShown(requested);
  const source = requested ?? shown;

  const [rootPath, setRootPath] = useState("");
  const [makeDefault, setMakeDefault] = useState(false);
  const [autoOrganize, setAutoOrganize] = useState(false);
  const [format, setFormat] = useState("");
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useFocusTrap(dialogRef, open);

  // Start from the source as it is each time the dialog opens.
  useEffect(() => {
    if (!requested) return;
    setRootPath(requested.rootPath ?? "");
    setMakeDefault(requested.importTarget);
    setAutoOrganize(requested.autoOrganize);
    setFormat(requested.pathFormat ?? "");
    setSaving(false);
    setError(null);
  }, [requested]);

  if (!source) return null;

  const id = (field: string) => `source-edit-${source.id}-${field}`;
  const busy = saving || picking;

  const changeLocation = async () => {
    setPicking(true);
    setError(null);
    try {
      const folder = await pickMusicFolder();
      if (folder) setRootPath(folder);
    } catch (err) {
      setError(describeSourceError(err));
    } finally {
      setPicking(false);
    }
  };

  const edits = (): SourceEdits => {
    const next: SourceEdits = {};
    if (rootPath && rootPath !== source.rootPath) next.rootPath = rootPath;
    if (makeDefault && !source.importTarget) next.makeDefault = true;
    if (autoOrganize !== source.autoOrganize) next.autoOrganize = autoOrganize;
    const pathFormat = normalizeFormat(format);
    if (pathFormat !== source.pathFormat) next.pathFormat = pathFormat;
    return next;
  };

  const save = async () => {
    if (busy) return;
    const changes = edits();
    if (Object.keys(changes).length === 0) {
      onClose();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(source, changes);
      onClose();
    } catch (err) {
      setError(describeSourceError(err));
      setSaving(false);
    }
  };

  const close = () => {
    if (saving) return;
    onClose();
  };

  // The default can only move to another folder, not be switched off here.
  const defaultLocked = source.importTarget;

  return (
    <Modal
      open={open}
      onClose={close}
      size="sm"
      panelClassName="source-edit"
      panelRef={dialogRef}
      labelledBy={titleId}
    >
      <ModalHeader>
        <ModalTitle id={titleId}>
          {t("preferences:sources.editTitle", {
            name: sourceDisplayName(source),
          })}
        </ModalTitle>
      </ModalHeader>

      <ModalBody>
        <div className="source-edit__fields">
          <div className="source-edit__field">
            <span className="source-edit__label">
              {t("preferences:sources.location")}
            </span>
            <div className="source-edit__location">
              <code className="source-edit__path">{rootPath}</code>
              <Button
                size="sm"
                disabled={busy}
                isLoading={picking}
                onClick={() => void changeLocation()}
              >
                <IconOpenFolder aria-hidden />
                {t("preferences:sources.changeLocation")}
              </Button>
            </div>
          </div>

          <Field orientation="horizontal" className="source-edit__switch">
            <Switch
              id={id("default")}
              checked={makeDefault}
              disabled={busy || defaultLocked || offline}
              onChange={(e) => setMakeDefault(e.target.checked)}
            />
            <FieldContent>
              <FieldLabel htmlFor={id("default")}>
                {t("preferences:sources.defaultFolder")}
              </FieldLabel>
              <FieldDescription>
                {defaultLocked
                  ? t("preferences:sources.defaultFolderCurrent")
                  : t("preferences:sources.defaultFolderDescription")}
              </FieldDescription>
            </FieldContent>
          </Field>

          <Field orientation="horizontal" className="source-edit__switch">
            <Switch
              id={id("organize")}
              checked={autoOrganize}
              disabled={busy}
              onChange={(e) => setAutoOrganize(e.target.checked)}
            />
            <FieldContent>
              <FieldLabel htmlFor={id("organize")}>
                {t("preferences:sources.organize")}
              </FieldLabel>
              <FieldDescription>
                {autoOrganize
                  ? t("preferences:sources.organizeOnDescription")
                  : t("preferences:sources.organizeOffDescription")}
              </FieldDescription>
            </FieldContent>
          </Field>

          <div className="source-edit__field">
            <label className="source-edit__label" htmlFor={id("format")}>
              {t("preferences:sources.pathFormat")}
            </label>
            <TextInput
              id={id("format")}
              value={format}
              placeholder={t("preferences:sources.useDefaultFormat")}
              spellCheck={false}
              disabled={busy}
              onChange={(e) => setFormat(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void save();
              }}
            />
            <p className="source-edit__hint">
              {t("preferences:sources.defaultFormat")}{" "}
              <code>{defaultFormat}</code>
            </p>
          </div>

          {error ? (
            <p className="preferences__error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </ModalBody>

      <ModalFooter onCancel={close} cancelDisabled={saving}>
        <Button
          variant="primary"
          disabled={busy}
          isLoading={saving}
          onClick={() => void save()}
        >
          {t("common:save")}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
