import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import {
  formatOrganizeRelativePath,
  GENERIC_ORGANIZE_PATH_SAMPLE,
  isDefaultOrganizePathFormat,
  previewSampleLabel,
  trackToOrganizePathSample,
  type OrganizePathSample,
} from "../../lib/organizePathFormat";
import {
  DEFAULT_CD_IMPORT_PROFILE_ID,
  ENCODING_PROFILE_SELECT_OPTIONS,
  isKnownEncodingProfileId,
  type EncodingProfileId,
} from "../../lib/encodingProfiles";
import { pickDatabaseFolder, pickFolder, clearMetadataCache } from "../../lib/tauri";
import { useCdStore } from "../../store/useCdStore";
import { useLibrarySettingsStore } from "../../store/useLibrarySettingsStore";
import { usePlayerStore } from "../../store/usePlayerStore";
import type { CdMetadataFetchMode, ImportMode, LibrarySettings } from "../../types/library";
import { Button } from "../common/Button/Button";
import { Checkbox } from "../common/Checkbox/Checkbox";
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
import { Select } from "../common/Select/Select";
import { IconCheck } from "../icons";
import "./PreferencesModal.css";

const IMPORT_MODE_OPTIONS: { value: ImportMode; label: string }[] = [
  { value: "ask", label: "Always ask" },
  { value: "copy", label: "Copy" },
  { value: "reference", label: "Reference" },
];

const CD_METADATA_FETCH_MODE_OPTIONS: {
  value: CdMetadataFetchMode;
  label: string;
}[] = [
  { value: "ask", label: "Always ask" },
  { value: "always", label: "Fetch automatically" },
  { value: "never", label: "Don't fetch" },
];

export function PreferencesModal() {
  const open = useLibrarySettingsStore((s) => s.preferencesOpen);
  const setOpen = useLibrarySettingsStore((s) => s.setPreferencesOpen);
  const settings = useLibrarySettingsStore((s) => s.settings);
  const saveLibrarySettings = useLibrarySettingsStore((s) => s.saveLibrarySettings);

  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  const [draft, setDraft] = useState<LibrarySettings | null>(null);
  const [previewSample, setPreviewSample] = useState<OrganizePathSample>(
    GENERIC_ORGANIZE_PATH_SAMPLE,
  );
  const [previewFromLibrary, setPreviewFromLibrary] = useState(false);
  const [restartHint, setRestartHint] = useState(false);
  const [saving, setSaving] = useState(false);
  const [clearingMetadataCache, setClearingMetadataCache] = useState(false);
  const [metadataCacheCleared, setMetadataCacheCleared] = useState(false);
  const metadataCacheClearedTimeoutRef = useRef<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusTrap(panelRef, open);

  useEffect(() => {
    return () => {
      if (metadataCacheClearedTimeoutRef.current != null) {
        window.clearTimeout(metadataCacheClearedTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!open || !settings) return;
    setDraft({ ...settings });
    setRestartHint(false);
    setError(null);
    setMetadataCacheCleared(false);
    const tracks = usePlayerStore.getState().library;
    if (tracks.length > 0) {
      setPreviewFromLibrary(true);
      setPreviewSample(
        trackToOrganizePathSample(
          tracks[Math.floor(Math.random() * tracks.length)]!,
        ),
      );
    } else {
      setPreviewFromLibrary(false);
      setPreviewSample(GENERIC_ORGANIZE_PATH_SAMPLE);
    }
  }, [open, settings]);

  const organizePreview = useMemo(() => {
    if (!draft?.autoOrganize) return null;
    return {
      label: previewSampleLabel(previewSample),
      path: formatOrganizeRelativePath(draft.organizePathFormat, previewSample),
      fromLibrary: previewFromLibrary,
      isDefault: isDefaultOrganizePathFormat(draft.organizePathFormat),
    };
  }, [
    draft?.autoOrganize,
    draft?.organizePathFormat,
    previewSample,
    previewFromLibrary,
  ]);

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
        organizePathFormat: draft.organizePathFormat,
        importMode: draft.importMode,
        cdMetadataFetchMode: draft.cdMetadataFetchMode,
        cdImportProfileId: draft.cdImportProfileId,
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

  const handleClearMetadataCache = async () => {
    setClearingMetadataCache(true);
    setError(null);
    try {
      await clearMetadataCache();
      setMetadataCacheCleared(true);
      if (metadataCacheClearedTimeoutRef.current != null) {
        window.clearTimeout(metadataCacheClearedTimeoutRef.current);
      }
      metadataCacheClearedTimeoutRef.current = window.setTimeout(() => {
        setMetadataCacheCleared(false);
        metadataCacheClearedTimeoutRef.current = null;
      }, 2000);
      useCdStore.getState().resetMetadataCacheState();
      void useCdStore.getState().refreshDrives();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setClearingMetadataCache(false);
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

          <Checkbox
            alignStart
            className="preferences__checkbox"
            checked={draft.autoOrganize}
            onChange={(e) =>
              setDraft((d) =>
                d ? { ...d, autoOrganize: e.target.checked } : d,
              )
            }
          >
            Automatically organize music in the media folder
          </Checkbox>

          <FormField label="Organization path format">
            <div className="preferences__path-row">
              <TextInput
                value={draft.organizePathFormat}
                disabled={!draft.autoOrganize}
                onChange={(e) =>
                  setDraft((d) =>
                    d ? { ...d, organizePathFormat: e.target.value } : d,
                  )
                }
                spellCheck={false}
              />
              <Button
                size="sm"
                disabled={
                  !draft.autoOrganize ||
                  isDefaultOrganizePathFormat(draft.organizePathFormat)
                }
                onClick={() =>
                  setDraft((d) =>
                    d
                      ? {
                          ...d,
                          organizePathFormat: d.defaultOrganizePathFormat,
                        }
                      : d,
                  )
                }
              >
                Reset
              </Button>
            </div>
          </FormField>
          {organizePreview && (
            <div className="preferences__filename-preview" aria-live="polite">
              <span className="preferences__filename-preview-label">
                Preview
                {organizePreview.fromLibrary
                  ? ` (${organizePreview.label})`
                  : " (example)"}
              </span>
              <code className="preferences__filename-preview-path">
                {organizePreview.path}
              </code>
            </div>
          )}
          <p className="preferences__hint">
            Relative path under your media folder. Use <code>/</code> between
            folders. Placeholders: <code>{"{albumArtist}"}</code>,{" "}
            <code>{"{artist}"}</code>, <code>{"{album}"}</code>,{" "}
            <code>{"{title}"}</code>, <code>{"{trackNumber:02}"}</code>,{" "}
            <code>{"{discNumber:02}"}</code>, <code>{"{year}"}</code>,{" "}
            <code>{"{genre}"}</code>, <code>{"{ext}"}</code>.
          </p>

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

        <section className="preferences__section" aria-labelledby="cd-prefs-heading">
          <h3 id="cd-prefs-heading" className="preferences__section-title">
            CD
          </h3>
          <p className="preferences__hint">
            When an audio CD is inserted, Spiral can look up album and track
            information from MusicBrainz.
          </p>

          <fieldset className="preferences__fieldset">
            <legend>Metadata lookup</legend>
            <div className="preferences__segmented">
              {CD_METADATA_FETCH_MODE_OPTIONS.map((opt) => (
                <label key={opt.value} className="preferences__segment">
                  <input
                    type="radio"
                    name="cdMetadataFetchMode"
                    value={opt.value}
                    checked={draft.cdMetadataFetchMode === opt.value}
                    onChange={() =>
                      setDraft((d) =>
                        d ? { ...d, cdMetadataFetchMode: opt.value } : d,
                      )
                    }
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </fieldset>

          <FormField
            label="When ripping to library"
            className="preferences__encoding-profiles"
          >
            <Select
              value={
                isKnownEncodingProfileId(draft.cdImportProfileId)
                  ? (draft.cdImportProfileId as EncodingProfileId)
                  : DEFAULT_CD_IMPORT_PROFILE_ID
              }
              onChange={(value) =>
                setDraft((d) => (d ? { ...d, cdImportProfileId: value } : d))
              }
              options={ENCODING_PROFILE_SELECT_OPTIONS}
              aria-label="CD import encoding profile"
            />
          </FormField>

          <p className="preferences__hint">
            Clears cached remote lookup results so the next fetch contacts
            MusicBrainz and art services again. Release preferences and
            downloaded art files are kept.
          </p>
          <Button
            variant="secondary"
            className={
              metadataCacheCleared
                ? "preferences__cache-clear-btn preferences__cache-clear-btn--success"
                : "preferences__cache-clear-btn"
            }
            onClick={() => void handleClearMetadataCache()}
            disabled={saving || clearingMetadataCache}
          >
            {clearingMetadataCache ? (
              "Clearing…"
            ) : metadataCacheCleared ? (
              <>
                <IconCheck aria-hidden />
                Cache cleared
              </>
            ) : (
              "Clear metadata cache"
            )}
          </Button>
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

          <Checkbox
            alignStart
            className="preferences__checkbox"
            checked={draft.metadataBackupsEnabled}
            onChange={(e) =>
              setDraft((d) =>
                d ? { ...d, metadataBackupsEnabled: e.target.checked } : d,
              )
            }
          >
            Keep backups before metadata edits
          </Checkbox>

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
