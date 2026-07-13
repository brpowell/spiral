import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useContextMenu } from "../../hooks/useContextMenu";
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
import { pickDatabaseFolder, pickFolder, clearMetadataCache, clearListenHistory } from "../../lib/tauri";
import { useCdStore } from "../../store/useCdStore";
import { useLibrarySettingsStore } from "../../store/useLibrarySettingsStore";
import { usePlaybackSettingsStore } from "../../store/usePlaybackSettingsStore";
import { usePlayerStore } from "../../store/usePlayerStore";
import { MIN_CROSSFADE_SECONDS, MAX_CROSSFADE_SECONDS } from "../../types/playbackSettings";
import type {
  CdMetadataFetchMode,
  ImportMode,
  LibrarySettings,
} from "../../types/library";
import { AlertConfirmation } from "../common/AlertConfirmation/AlertConfirmation";
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
import { Slider } from "../common/Slider/Slider";
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuSeparator,
} from "../ContextMenu/ContextMenu";
import { IconCheck, IconChevronDown } from "../icons";
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

/** Browser-style clear ranges: hours to delete, or null for all time. */
const CLEAR_HISTORY_RANGES: { withinHours: number | null; label: string }[] = [
  { withinHours: 1, label: "Last hour" },
  { withinHours: 24, label: "Last 24 hours" },
  { withinHours: 24 * 7, label: "Last 7 days" },
  { withinHours: 24 * 7 * 4, label: "Last 4 weeks" },
  { withinHours: null, label: "All time" },
];

export function PreferencesModal() {
  const open = useLibrarySettingsStore((s) => s.preferencesOpen);
  const setOpen = useLibrarySettingsStore((s) => s.setPreferencesOpen);
  const settings = useLibrarySettingsStore((s) => s.settings);
  const saveLibrarySettings = useLibrarySettingsStore((s) => s.saveLibrarySettings);
  const crossfadeEnabled = usePlaybackSettingsStore((s) => s.crossfadeEnabled);
  const crossfadeSeconds = usePlaybackSettingsStore((s) => s.crossfadeSeconds);
  const crossfadeOnSkip = usePlaybackSettingsStore((s) => s.crossfadeOnSkip);
  const crossfadeVisualEnabled = usePlaybackSettingsStore(
    (s) => s.crossfadeVisualEnabled,
  );
  const setCrossfadeEnabled = usePlaybackSettingsStore((s) => s.setCrossfadeEnabled);
  const setCrossfadeSeconds = usePlaybackSettingsStore((s) => s.setCrossfadeSeconds);
  const setCrossfadeOnSkip = usePlaybackSettingsStore((s) => s.setCrossfadeOnSkip);
  const setCrossfadeVisualEnabled = usePlaybackSettingsStore(
    (s) => s.setCrossfadeVisualEnabled,
  );

  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const clearHistoryTriggerRef = useRef<HTMLButtonElement>(null);

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
  const [clearHistoryOpen, setClearHistoryOpen] = useState(false);
  const [clearingHistory, setClearingHistory] = useState(false);
  const [historyCleared, setHistoryCleared] = useState(false);
  const historyClearedTimeoutRef = useRef<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const {
    open: clearRangeMenuOpen,
    anchor: clearRangeAnchor,
    position: clearRangePosition,
    menuRef: clearRangeMenuRef,
    toggleFromTrigger: toggleClearRangeMenu,
    closeMenu: closeClearRangeMenu,
  } = useContextMenu({
    layoutDeps: [clearingHistory],
    dismissExcludeRefs: [clearHistoryTriggerRef],
    triggerPlacement: "below-start",
  });

  useFocusTrap(panelRef, open);

  useEffect(() => {
    return () => {
      if (metadataCacheClearedTimeoutRef.current != null) {
        window.clearTimeout(metadataCacheClearedTimeoutRef.current);
      }
      if (historyClearedTimeoutRef.current != null) {
        window.clearTimeout(historyClearedTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!open || !settings) return;
    setDraft({ ...settings });
    setRestartHint(false);
    setError(null);
    setMetadataCacheCleared(false);
    setHistoryCleared(false);
    setClearHistoryOpen(false);
    closeClearRangeMenu();
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
  }, [open, settings, closeClearRangeMenu]);

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
        listeningHistoryEnabled: draft.listeningHistoryEnabled,
        lyricsSidecarSyncEnabled: draft.lyricsSidecarSyncEnabled,
        lyricsAutoFetchInLightbox: draft.lyricsAutoFetchInLightbox,
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

  const handleClearListeningHistory = async (withinHours: number | null) => {
    setClearingHistory(true);
    setError(null);
    try {
      const result = await clearListenHistory({ withinHours });
      if (result.resetCounters) {
        await usePlayerStore.getState().loadLibrary({ preservePlayback: true });
      }
      setHistoryCleared(true);
      if (historyClearedTimeoutRef.current != null) {
        window.clearTimeout(historyClearedTimeoutRef.current);
      }
      historyClearedTimeoutRef.current = window.setTimeout(() => {
        setHistoryCleared(false);
        historyClearedTimeoutRef.current = null;
      }, 2000);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      throw err;
    } finally {
      setClearingHistory(false);
    }
  };

  const handleClearRange = (withinHours: number | null) => {
    closeClearRangeMenu();
    if (withinHours == null) {
      setClearHistoryOpen(true);
      return;
    }
    void handleClearListeningHistory(withinHours).catch(() => {
      /* error already set */
    });
  };

  return (
    <>
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
            aria-labelledby="playback-prefs-heading"
          >
            <h3 id="playback-prefs-heading" className="preferences__section-title">
              Playback
            </h3>

            <Checkbox
              alignStart
              className="preferences__checkbox"
              checked={crossfadeEnabled}
              onChange={(e) => setCrossfadeEnabled(e.target.checked)}
            >
              Crossfade between tracks
            </Checkbox>

            <FormField label="Crossfade duration">
              <Slider
                min={MIN_CROSSFADE_SECONDS}
                max={MAX_CROSSFADE_SECONDS}
                step={1}
                value={crossfadeSeconds}
                disabled={!crossfadeEnabled}
                onChange={(e) =>
                  setCrossfadeSeconds(Number.parseInt(e.target.value, 10))
                }
                aria-label="Crossfade duration in seconds"
                showValueTooltip
                formatValueTooltip={(value) => `${value} s`}
              />
            </FormField>

            <Checkbox
              alignStart
              className="preferences__checkbox"
              checked={crossfadeOnSkip}
              disabled={!crossfadeEnabled}
              onChange={(e) => setCrossfadeOnSkip(e.target.checked)}
            >
              Crossfade when skipping tracks
            </Checkbox>

            <Checkbox
              alignStart
              className="preferences__checkbox"
              checked={crossfadeVisualEnabled}
              disabled={!crossfadeEnabled}
              onChange={(e) => setCrossfadeVisualEnabled(e.target.checked)}
            >
              Animate now playing during crossfade
            </Checkbox>

            <p className="preferences__hint">
              Crossfade applies between mp3, flac, aac, wav, and m4a tracks.
              OGG, Opus, and CD transitions are not supported and will instantly switch.
            </p>
          </section>

          <section
            className="preferences__section"
            aria-labelledby="lyrics-prefs-heading"
          >
            <h3 id="lyrics-prefs-heading" className="preferences__section-title">
              Lyrics
            </h3>
            <p className="preferences__hint">
              Line-synced lyrics can be stored in a sibling <code>.lrc</code> file
              next to the audio track. When enabled, Spiral reads existing{" "}
              <code>.lrc</code> files on import and keeps them in sync on save.
              Spiral can also look up lyrics from{" "}
              <a href="https://lrclib.net" target="_blank" rel="noreferrer">
                LRCLIB
              </a>
              .
            </p>

            <Checkbox
              alignStart
              className="preferences__checkbox"
              checked={draft.lyricsAutoFetchInLightbox}
              onChange={(e) =>
                setDraft((d) =>
                  d
                    ? { ...d, lyricsAutoFetchInLightbox: e.target.checked }
                    : d,
                )
              }
            >
              Automatically fetch lyrics when viewing album art
            </Checkbox>

            <Checkbox
              alignStart
              className="preferences__checkbox"
              checked={draft.lyricsSidecarSyncEnabled}
              onChange={(e) =>
                setDraft((d) =>
                  d ? { ...d, lyricsSidecarSyncEnabled: e.target.checked } : d,
                )
              }
            >
              Read and write line-synced lyrics via .lrc sidecar files
            </Checkbox>
          </section>

          <section
            className="preferences__section"
            aria-labelledby="listening-prefs-heading"
          >
            <h3 id="listening-prefs-heading" className="preferences__section-title">
              Listening / Privacy
            </h3>
            <p className="preferences__hint">
              Spiral records local listen history for play counts and personal
              insights. Turning recording off stops new history rows and play-count
              updates; existing history stays until you clear it.
            </p>

            <Checkbox
              alignStart
              className="preferences__checkbox"
              checked={draft.listeningHistoryEnabled}
              onChange={(e) =>
                setDraft((d) =>
                  d ? { ...d, listeningHistoryEnabled: e.target.checked } : d,
                )
              }
            >
              Record listening history
            </Checkbox>

            <div className="preferences__clear-history">
              <Button
                ref={clearHistoryTriggerRef}
                variant="secondary"
                className={
                  historyCleared
                    ? "preferences__cache-clear-btn preferences__cache-clear-btn--success"
                    : "preferences__clear-history-btn"
                }
                onClick={() => toggleClearRangeMenu(clearHistoryTriggerRef.current)}
                disabled={saving || clearingHistory}
                aria-haspopup="menu"
                aria-expanded={clearRangeMenuOpen}
              >
                {clearingHistory ? (
                  "Clearing…"
                ) : historyCleared ? (
                  <>
                    <IconCheck aria-hidden />
                    History cleared
                  </>
                ) : (
                  <>
                    Clear listening history
                    <IconChevronDown aria-hidden />
                  </>
                )}
              </Button>
              <ContextMenu
                open={clearRangeMenuOpen}
                anchor={clearRangeAnchor}
                position={clearRangePosition}
                menuRef={clearRangeMenuRef}
              >
                {CLEAR_HISTORY_RANGES.flatMap((range) => {
                  const item = (
                    <ContextMenuItem
                      key={range.label}
                      label={range.label}
                      disabled={clearingHistory}
                      onClick={() => handleClearRange(range.withinHours)}
                    />
                  );
                  return range.withinHours == null
                    ? [<ContextMenuSeparator key="clear-all-sep" />, item]
                    : [item];
                })}
              </ContextMenu>
            </div>
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

      <AlertConfirmation
        open={clearHistoryOpen}
        onClose={() => {
          if (clearingHistory) return;
          setClearHistoryOpen(false);
        }}
        title="Clear all listening history?"
        confirmLabel={clearingHistory ? "Clearing…" : "Clear all history"}
        onConfirm={() => handleClearListeningHistory(null)}
      >
        <p>
          All personal insights will be permanently lost.
        </p>
      </AlertConfirmation>
    </>
  );
}
