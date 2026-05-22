import { useEffect, useId, useRef, useState } from "react";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { pickDatabaseFolder, pickFolder } from "../../lib/tauri";
import { useLibrarySettingsStore } from "../../store/useLibrarySettingsStore";
import type { ImportMode, LibrarySettings } from "../../types/library";
import { Button } from "../common/Button/Button";
import { FormField } from "../common/Field/Field";
import {
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from "../common/Modal/Modal";
import { TextInput } from "../common/TextInput/TextInput";
import "./PreferencesModal.css";

const IMPORT_MODE_OPTIONS: { value: ImportMode; label: string }[] = [
  { value: "ask", label: "Always ask" },
  { value: "copy", label: "Copy" },
  { value: "reference", label: "Reference" },
];

export function PreferencesModal() {
  const open = useLibrarySettingsStore((s) => s.preferencesOpen);
  const setOpen = useLibrarySettingsStore((s) => s.setPreferencesOpen);
  const settings = useLibrarySettingsStore((s) => s.settings);
  const saveLibrarySettings = useLibrarySettingsStore((s) => s.saveLibrarySettings);

  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  const [draft, setDraft] = useState<LibrarySettings | null>(null);
  const [restartHint, setRestartHint] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useFocusTrap(panelRef, open);

  useEffect(() => {
    if (!open || !settings) return;
    setDraft({ ...settings });
    setRestartHint(false);
    setError(null);
  }, [open, settings]);

  if (!draft) return null;

  const handleSave = async () => {
    if (!settings) return;
    setSaving(true);
    setError(null);
    try {
      const dbChanged = draft.databasePath !== settings.databasePath;
      await saveLibrarySettings({
        mediaFolder: draft.mediaFolder,
        databasePath: draft.databasePath,
        autoOrganize: draft.autoOrganize,
        importMode: draft.importMode,
        metadataBackupsEnabled: draft.metadataBackupsEnabled,
        metadataBackupRetentionDays: draft.metadataBackupRetentionDays,
      });
      setRestartHint(dbChanged);
      if (!dbChanged) setOpen(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  const browseMediaFolder = async () => {
    const paths = await pickFolder();
    if (paths[0]) {
      setDraft((d) => (d ? { ...d, mediaFolder: paths[0] } : d));
    }
  };

  const browseDatabaseFolder = async () => {
    const folder = await pickDatabaseFolder();
    if (folder) {
      const sep = folder.includes("\\") ? "\\" : "/";
      setDraft((d) =>
        d ? { ...d, databasePath: `${folder}${sep}Library.db` } : d,
      );
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      size="lg"
      panelRef={panelRef}
      labelledBy={titleId}
    >
      <ModalHeader>
        <ModalTitle id={titleId}>Preferences</ModalTitle>
        <ModalCloseButton onClick={() => setOpen(false)} />
      </ModalHeader>

      <ModalBody className="preferences__body">
        <section className="preferences__section" aria-labelledby="library-prefs-heading">
          <h3 id="library-prefs-heading" className="preferences__section-title">
            Library
          </h3>

          <FormField label="Media folder">
            <div className="preferences__path-row">
              <TextInput
                value={draft.mediaFolder}
                onChange={(e) =>
                  setDraft((d) => (d ? { ...d, mediaFolder: e.target.value } : d))
                }
                spellCheck={false}
              />
              <Button size="sm" onClick={() => void browseMediaFolder()}>
                Choose…
              </Button>
            </div>
          </FormField>

          <FormField label="Database location">
            <div className="preferences__path-row">
              <TextInput
                value={draft.databasePath}
                onChange={(e) =>
                  setDraft((d) =>
                    d ? { ...d, databasePath: e.target.value } : d,
                  )
                }
                spellCheck={false}
              />
              <Button size="sm" onClick={() => void browseDatabaseFolder()}>
                Choose…
              </Button>
            </div>
          </FormField>

          <label className="preferences__checkbox">
            <input
              type="checkbox"
              checked={draft.autoOrganize}
              onChange={(e) =>
                setDraft((d) =>
                  d ? { ...d, autoOrganize: e.target.checked } : d,
                )
              }
            />
            Automatically organize music (Artist → Album → Track)
          </label>

          <fieldset className="preferences__fieldset">
            <legend>When importing</legend>
            <div className="preferences__segmented">
              {IMPORT_MODE_OPTIONS.map((opt) => (
                <label key={opt.value} className="preferences__segment">
                  <input
                    type="radio"
                    name="importMode"
                    value={opt.value}
                    checked={draft.importMode === opt.value}
                    onChange={() =>
                      setDraft((d) =>
                        d ? { ...d, importMode: opt.value } : d,
                      )
                    }
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </fieldset>
        </section>

        <section
          className="preferences__section"
          aria-labelledby="metadata-backups-heading"
        >
          <h3 id="metadata-backups-heading" className="preferences__section-title">
            Metadata backups
          </h3>
          <p className="preferences__hint">
            When you edit tags, Spiral can keep a copy of the original file next to
            the track (for example <code>song.m4a.bak</code>). Older backups are
            removed automatically.
          </p>

          <label className="preferences__checkbox">
            <input
              type="checkbox"
              checked={draft.metadataBackupsEnabled}
              onChange={(e) =>
                setDraft((d) =>
                  d ? { ...d, metadataBackupsEnabled: e.target.checked } : d,
                )
              }
            />
            Keep backups before metadata edits
          </label>

          <FormField label="Retention (days)">
            <TextInput
              type="number"
              min={1}
              max={3650}
              value={draft.metadataBackupRetentionDays}
              disabled={!draft.metadataBackupsEnabled}
              onChange={(e) => {
                const n = Number.parseInt(e.target.value, 10);
                if (!Number.isFinite(n)) return;
                setDraft((d) =>
                  d
                    ? {
                      ...d,
                      metadataBackupRetentionDays: Math.min(
                        3650,
                        Math.max(1, n),
                      ),
                    }
                    : d,
                );
              }}
            />
          </FormField>
        </section>

        {restartHint && (
          <p className="preferences__notice" role="status">
            Restart Spiral to use the new database location.
          </p>
        )}

        {error && (
          <p className="preferences__error" role="alert">
            {error}
          </p>
        )}
      </ModalBody>

      <ModalFooter
        cancelLabel={restartHint ? "Close" : "Cancel"}
        onCancel={() => setOpen(false)}
        cancelDisabled={saving}
      >
        {!restartHint && (
          <Button
            variant="primary"
            onClick={() => void handleSave()}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        )}
      </ModalFooter>
    </Modal>
  );
}
