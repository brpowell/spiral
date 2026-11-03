import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useEditorDiscardPrompt } from "../../hooks/useEditorDiscardPrompt";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useShortenHomePath } from "../../lib/homePath";
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
import { EditorDiscardOverlay } from "../EditorDiscardOverlay/EditorDiscardOverlay";
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
  autoOrganize?: boolean;
  /** The source's own format; null goes back to the default one. */
  pathFormat?: string | null;
}

interface SourceEditDialogProps {
  source: Source | null;
  /** The global path format a source without its own uses. */
  defaultFormat: string;
  /** The track the format preview is shown for. */
  previewSample: OrganizePathSample;
  onClose: () => void;
  /** Applies the edits. Throwing keeps the dialog open with the error. */
  onSave: (source: Source, edits: SourceEdits) => Promise<void>;
  /**
   * The source was just added: the dialog finishes adding it, so its button
   * works with the defaults as they are, and cancelling calls this (to take
   * the source back out) instead of {@link onClose}.
   */
  onCancelAdd?: () => void;
}

/**
 * Edit a source: its location and how Spiral organizes it. Nothing changes
 * until Save, and closing with unsaved changes asks first.
 */
export function SourceEditDialog({
  source: requested,
  defaultFormat,
  previewSample,
  onClose,
  onSave,
  onCancelAdd,
}: SourceEditDialogProps) {
  const { t } = useTranslation(["preferences", "common"]);
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const formatRef = useRef<HTMLInputElement>(null);
  const displayPath = useShortenHomePath();
  const open = requested != null;
  // Keep showing the last source while the dialog animates closed.
  const [shown, setShown] = useState<Source | null>(requested);
  if (requested && requested !== shown) setShown(requested);
  const source = requested ?? shown;

  const [rootPath, setRootPath] = useState("");
  const [autoOrganize, setAutoOrganize] = useState(false);
  const [format, setFormat] = useState("");
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);
  const [tokensOpen, setTokensOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useFocusTrap(dialogRef, open);

  // Blank uses the default format, so preview that.
  const preview = useMemo(
    () =>
      formatOrganizeRelativePath(format.trim() || defaultFormat, previewSample),
    [format, defaultFormat, previewSample],
  );

  // Compared by meaning, so editing a field back to how it was counts as clean.
  const changes: SourceEdits = {};
  if (source) {
    if (rootPath && rootPath !== source.rootPath) changes.rootPath = rootPath;
    if (autoOrganize !== source.autoOrganize) {
      changes.autoOrganize = autoOrganize;
    }
    const pathFormat = normalizeFormat(format);
    if (pathFormat !== source.pathFormat) changes.pathFormat = pathFormat;
  }
  const dirty = Object.keys(changes).length > 0;
  const adding = onCancelAdd != null;
  // Cancelling an add takes the folder back out, so its edits go with it.
  const cancel = onCancelAdd ?? onClose;

  const {
    discardPrompt,
    setDiscardPrompt,
    requestClose,
    handleBackdropClick,
    dismissDiscardPrompt,
  } = useEditorDiscardPrompt(dirty && !adding, cancel, saving);

  // Start from the source as it is each time the dialog opens.
  useEffect(() => {
    if (!requested) return;
    setRootPath(requested.rootPath ?? "");
    setAutoOrganize(requested.autoOrganize);
    setFormat(requested.pathFormat ?? "");
    setSaving(false);
    setTokensOpen(false);
    setError(null);
    setDiscardPrompt(false);
  }, [requested, setDiscardPrompt]);

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

  const save = async () => {
    if (busy || (!dirty && !adding)) return;
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

  return (
    <Modal
      open={open}
      onClose={handleBackdropClick}
      dismissible={!saving}
      size="lg"
      panelClassName="source-edit"
      panelRef={dialogRef}
      labelledBy={titleId}
    >
      <ModalHeader>
        <ModalTitle id={titleId}>
          {adding
            ? t("preferences:sources.addTitle")
            : t("preferences:sources.editTitle")}
        </ModalTitle>
      </ModalHeader>

      <ModalBody>
        <div className="source-edit__fields" inert={discardPrompt || undefined}>
          <div className="source-edit__field">
            <span className="source-edit__label">
              {t("preferences:sources.location")}
            </span>
            <div className="source-edit__location">
              <code className="source-edit__path" title={rootPath}>
                {displayPath(rootPath)}
              </code>
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

          {/* The format belongs to organizing: nested under it, and off with it. */}
          <div className="source-edit__organize">
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

            <div
              className="source-edit__field source-edit__format"
              data-off={!autoOrganize || undefined}
              inert={!autoOrganize || undefined}
            >
              <label className="source-edit__label" htmlFor={id("format")}>
                {t("preferences:sources.pathFormat")}
              </label>
              <TextInput
                ref={formatRef}
                id={id("format")}
                value={format}
                placeholder={defaultFormat}
                spellCheck={false}
                disabled={busy || !autoOrganize}
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
                open={tokensOpen}
                onOpenChange={setTokensOpen}
                label={
                  tokensOpen
                    ? t("preferences:sources.hideFormatTokens")
                    : t("preferences:sources.formatTokens")
                }
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
          </div>

          {error ? (
            <p className="preferences__error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </ModalBody>

      <ModalFooter
        inert={discardPrompt || undefined}
        onCancel={requestClose}
        cancelDisabled={saving}
      >
        <Button
          variant="primary"
          disabled={busy || (!dirty && !adding) || discardPrompt}
          isLoading={saving}
          onClick={() => void save()}
        >
          {adding ? t("preferences:sources.addConfirm") : t("common:save")}
        </Button>
      </ModalFooter>

      <EditorDiscardOverlay
        open={discardPrompt}
        description={t("preferences:sources.discardEdits")}
        onKeepEditing={dismissDiscardPrompt}
        onDiscard={() => {
          setDiscardPrompt(false);
          cancel();
        }}
      />
    </Modal>
  );
}
