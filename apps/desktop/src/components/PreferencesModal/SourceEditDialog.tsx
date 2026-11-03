import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import {
  formatOrganizeRelativePath,
  type OrganizePathSample,
} from "../../lib/organizePathFormat";
import { describeSourceError } from "../../lib/sourceAccess";
import { pickMusicFolder } from "../../lib/tauri";
import type { Source } from "../../types/source";
import { Button } from "../common/Button/Button";
import { Checkbox } from "../common/Checkbox/Checkbox";
import { Disclosure } from "../common/Disclosure/Disclosure";
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
import { TextInput } from "../common/TextInput/TextInput";
import { IconOpenFolder } from "../icons";
import "./SourceEditDialog.css";

/** The placeholders a path format can use, in the order they're listed. */
export const PATH_FORMAT_TOKENS = [
  "albumArtist",
  "artist",
  "album",
  "title",
  "trackNumber:02",
  "discNumber:02",
  "year",
  "genre",
  "ext",
] as const;

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
  /** The track the format preview is shown for. */
  previewSample: OrganizePathSample;
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
  previewSample,
  onClose,
  onSave,
}: SourceEditDialogProps) {
  const { t } = useTranslation(["preferences", "common"]);
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const formatRef = useRef<HTMLInputElement>(null);
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

  // Blank uses the default format, so preview that.
  const preview = useMemo(
    () =>
      formatOrganizeRelativePath(format.trim() || defaultFormat, previewSample),
    [format, defaultFormat, previewSample],
  );

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

  /** Puts a placeholder at the cursor, replacing any selection. */
  const insertToken = (token: string) => {
    const input = formatRef.current;
    const text = `{${token}}`;
    const current = format;
    const start = input?.selectionStart ?? current.length;
    const end = input?.selectionEnd ?? current.length;
    const next = current.slice(0, start) + text + current.slice(end);
    setFormat(next);
    requestAnimationFrame(() => {
      if (!input) return;
      input.focus();
      input.setSelectionRange(start + text.length, start + text.length);
    });
  };

  const close = () => {
    if (saving) return;
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      size="lg"
      panelClassName="source-edit"
      panelRef={dialogRef}
      labelledBy={titleId}
    >
      <ModalHeader>
        <ModalTitle id={titleId}>
          {t("preferences:sources.editTitle")}
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

          {source.importTarget ? (
            // Exactly one folder is the default, so the current one has
            // nothing to toggle; another folder takes it over.
            <div className="source-edit__field">
              <span className="source-edit__label">
                {t("preferences:sources.defaultFolder")}
              </span>
              <p className="source-edit__hint">
                {t("preferences:sources.defaultFolderCurrent")}
              </p>
            </div>
          ) : (
            <Field orientation="horizontal" className="source-edit__option">
              <Checkbox
                id={id("default")}
                checked={makeDefault}
                disabled={busy || offline}
                onChange={(e) => setMakeDefault(e.target.checked)}
              />
              <FieldContent>
                <FieldLabel htmlFor={id("default")}>
                  {t("preferences:sources.makeDefault")}
                </FieldLabel>
                <FieldDescription>
                  {offline
                    ? t("preferences:sources.makeDefaultOffline")
                    : t("preferences:sources.defaultFolderDescription")}
                </FieldDescription>
              </FieldContent>
            </Field>
          )}

          <Field orientation="horizontal" className="source-edit__option">
            <Checkbox
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
                {t("preferences:sources.organizeDescription")}
              </FieldDescription>
            </FieldContent>
          </Field>

          <div className="source-edit__field">
            <label className="source-edit__label" htmlFor={id("format")}>
              {t("preferences:sources.pathFormat")}
            </label>
            <TextInput
              ref={formatRef}
              id={id("format")}
              value={format}
              placeholder={defaultFormat}
              spellCheck={false}
              disabled={busy}
              onChange={(e) => setFormat(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void save();
              }}
            />
            <p className="source-edit__hint" aria-live="polite">
              {t("preferences:sources.formatPreview")}{" "}
              <code className="source-edit__preview">{preview}</code>
            </p>
            <Disclosure
              className="source-edit__tokens"
              label={t("preferences:sources.formatTokens")}
            >
              <ul className="source-edit__token-list">
                {PATH_FORMAT_TOKENS.map((token) => (
                  <li key={token}>
                    <button
                      type="button"
                      className="source-edit__token"
                      disabled={busy}
                      title={t("preferences:sources.insertToken")}
                      onClick={() => insertToken(token)}
                    >
                      <code>{`{${token}}`}</code>
                    </button>
                    <span className="source-edit__token-description">
                      {t(`preferences:sources.tokens.${token.split(":")[0]}`)}
                    </span>
                  </li>
                ))}
              </ul>
            </Disclosure>
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
