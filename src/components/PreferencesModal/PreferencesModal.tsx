import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useContextMenu } from "../../hooks/useContextMenu";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import {
  formatOrganizeRelativePath,
  GENERIC_ORGANIZE_PATH_SAMPLE,
  isDefaultOrganizePathFormat,
  trackToOrganizePathSample,
  type OrganizePathSample,
} from "../../lib/organizePathFormat";
import {
  DEFAULT_CD_IMPORT_PROFILE_ID,
  ENCODING_PROFILE_SELECT_OPTIONS,
  isKnownEncodingProfileId,
  type EncodingProfileId,
} from "../../lib/encodingProfiles";
import {
  pickLibraryFolder,
  clearMetadataCache,
  clearListenHistory,
  inspectLibraryDestination,
  relocateLibrary,
  getDefaultAuthorId,
  saveDefaultAuthorId,
} from "../../lib/tauri";
import { stopPlaybackForLibraryRelocate } from "../../lib/libraryRelocatePlayback";
import { isAuthorId } from "../../lib/packs/packManifest";
import { useArtistImageStore } from "../../store/useArtistImageStore";
import { useCdStore } from "../../store/useCdStore";
import { useLibrarySettingsStore } from "../../store/useLibrarySettingsStore";
import { usePlaybackSettingsStore } from "../../store/usePlaybackSettingsStore";
import { usePlayerStore } from "../../store/usePlayerStore";
import { usePlaylistStore } from "../../store/usePlaylistStore";
import { useUpdaterStore } from "../../store/useUpdaterStore";
import {
  MIN_CROSSFADE_SECONDS,
  MAX_CROSSFADE_SECONDS,
} from "../../types/playbackSettings";
import type {
  CdMetadataFetchMode,
  ImportMode,
  LibraryDestinationInfo,
  LibraryRelocateMode,
  LibrarySettingsPatch,
} from "../../types/library";
import { AlertConfirmation } from "../common/AlertConfirmation/AlertConfirmation";
import { Button } from "../common/Button/Button";
import { Checkbox } from "../common/Checkbox/Checkbox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FormField,
} from "../common/Field/Field";
import {
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalHeader,
  ModalTitle,
} from "../common/Modal/Modal";
import { RadioGroup, RadioGroupItem } from "../common/RadioGroup/RadioGroup";
import { Separator } from "../common/Separator/Separator";
import { TextInput } from "../common/TextInput/TextInput";
import { TextLink } from "../common/TextLink/TextLink";
import { Select } from "../common/Select/Select";
import { Slider } from "../common/Slider/Slider";
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuSeparator,
} from "../ContextMenu/ContextMenu";
import { SidebarItem } from "../layout/SidebarItem/SidebarItem";
import { SidebarFrame, SidebarList } from "../layout/SidebarChrome";
import {
  IconCheck,
  IconChevronDown,
  IconOpenFolder,
  IconRefresh,
  IconReset,
} from "../icons";
import { LibraryRelocateDialog } from "./LibraryRelocateDialog";
import {
  PREFERENCES_SECTIONS,
  type PreferencesSectionId,
} from "./preferencesSections";
import "./PreferencesModal.css";

const IMPORT_MODE_OPTIONS: { value: ImportMode; label: string }[] = [
  { value: "copy", label: "Copy into library" },
  { value: "reference", label: "Reference from source" },
  { value: "ask", label: "Always ask" },
];

const CD_METADATA_FETCH_MODE_OPTIONS: {
  value: CdMetadataFetchMode;
  label: string;
}[] = [
  { value: "always", label: "Automatically" },
  { value: "ask", label: "Always ask" },
  { value: "never", label: "Never" },
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
  const consumePreferencesFocusSection = useLibrarySettingsStore(
    (s) => s.consumePreferencesFocusSection,
  );
  const settings = useLibrarySettingsStore((s) => s.settings);
  const saveLibrarySettings = useLibrarySettingsStore(
    (s) => s.saveLibrarySettings,
  );
  const applyLibrarySettings = useLibrarySettingsStore(
    (s) => s.applyLibrarySettings,
  );
  const crossfadeEnabled = usePlaybackSettingsStore((s) => s.crossfadeEnabled);
  const crossfadeSeconds = usePlaybackSettingsStore((s) => s.crossfadeSeconds);
  const crossfadeOnSkip = usePlaybackSettingsStore((s) => s.crossfadeOnSkip);
  const crossfadeVisualEnabled = usePlaybackSettingsStore(
    (s) => s.crossfadeVisualEnabled,
  );
  const setCrossfadeEnabled = usePlaybackSettingsStore(
    (s) => s.setCrossfadeEnabled,
  );
  const setCrossfadeSeconds = usePlaybackSettingsStore(
    (s) => s.setCrossfadeSeconds,
  );
  const setCrossfadeOnSkip = usePlaybackSettingsStore(
    (s) => s.setCrossfadeOnSkip,
  );
  const setCrossfadeVisualEnabled = usePlaybackSettingsStore(
    (s) => s.setCrossfadeVisualEnabled,
  );
  const automaticChecksEnabled = useUpdaterStore(
    (s) => s.automaticChecksEnabled,
  );
  const setAutomaticChecksEnabled = useUpdaterStore(
    (s) => s.setAutomaticChecksEnabled,
  );
  const checkForUpdates = useUpdaterStore((s) => s.checkForUpdates);
  const availableUpdate = useUpdaterStore((s) => s.availableUpdate);
  const updaterStatus = useUpdaterStore((s) => s.status);
  const { t } = useTranslation(["preferences", "common"]);

  const titleId = useId();
  const importModeLabelId = useId();
  const cdMetadataFetchModeLabelId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const clearHistoryTriggerRef = useRef<HTMLButtonElement>(null);

  const [activeSection, setActiveSection] =
    useState<PreferencesSectionId>("library");
  const [libraryRoot, setLibraryRoot] = useState("");
  const [organizePathFormat, setOrganizePathFormat] = useState("");
  const [previewSample, setPreviewSample] = useState<OrganizePathSample>(
    GENERIC_ORGANIZE_PATH_SAMPLE,
  );
  const [clearingMetadataCache, setClearingMetadataCache] = useState(false);
  const [metadataCacheCleared, setMetadataCacheCleared] = useState(false);
  const metadataCacheClearedTimeoutRef = useRef<number | null>(null);
  const [clearHistoryOpen, setClearHistoryOpen] = useState(false);
  const [clearingHistory, setClearingHistory] = useState(false);
  const [historyCleared, setHistoryCleared] = useState(false);
  const historyClearedTimeoutRef = useRef<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [relocateInfo, setRelocateInfo] =
    useState<LibraryDestinationInfo | null>(null);
  const [relocateBusy, setRelocateBusy] = useState(false);
  const relocateInspectingRef = useRef(false);
  const [defaultAuthorId, setDefaultAuthorId] = useState("");
  const [defaultAuthorIdLoaded, setDefaultAuthorIdLoaded] = useState(false);
  const [savingDefaultAuthorId, setSavingDefaultAuthorId] = useState(false);
  const lastPersistedAuthorIdRef = useRef("");

  const {
    open: clearRangeMenuOpen,
    anchor: clearRangeAnchor,
    position: clearRangePosition,
    menuRef: clearRangeMenuRef,
    openedWithKeyboard: clearRangeOpenedWithKeyboard,
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
    if (!open) return;
    const current = useLibrarySettingsStore.getState().settings;
    if (!current) return;
    const focus = consumePreferencesFocusSection();
    setActiveSection(focus ?? "library");
    setLibraryRoot(current.libraryRoot);
    setOrganizePathFormat(current.organizePathFormat);
    setError(null);
    setRelocateInfo(null);
    setRelocateBusy(false);
    setMetadataCacheCleared(false);
    setHistoryCleared(false);
    setClearHistoryOpen(false);
    closeClearRangeMenu();
    setDefaultAuthorIdLoaded(false);
    const tracks = usePlayerStore.getState().library;
    if (tracks.length > 0) {
      setPreviewSample(
        trackToOrganizePathSample(
          tracks[Math.floor(Math.random() * tracks.length)]!,
        ),
      );
    } else {
      setPreviewSample(GENERIC_ORGANIZE_PATH_SAMPLE);
    }
  }, [open, closeClearRangeMenu, consumePreferencesFocusSection]);

  useEffect(() => {
    if (!open || activeSection !== "studio" || defaultAuthorIdLoaded) return;
    let cancelled = false;
    void getDefaultAuthorId()
      .then((id) => {
        if (!cancelled) {
          setDefaultAuthorId(id);
          lastPersistedAuthorIdRef.current = id;
          setDefaultAuthorIdLoaded(true);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          console.error("Failed to load default author id:", err);
          setDefaultAuthorIdLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, activeSection, defaultAuthorIdLoaded]);

  const organizePreviewPath = useMemo(() => {
    if (!settings) return null;
    return formatOrganizeRelativePath(organizePathFormat, previewSample);
  }, [settings, organizePathFormat, previewSample]);

  if (!settings) return null;

  const patchSettings = (patch: LibrarySettingsPatch) => {
    setError(null);
    void saveLibrarySettings(patch).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    });
  };

  const reloadAfterRelocate = async () => {
    await usePlayerStore.getState().loadLibrary();
    await usePlaylistStore.getState().loadPlaylists();
    await useArtistImageStore.getState().loadArtistImages();
  };

  const beginLibraryRootChange = async (value: string = libraryRoot) => {
    const trimmed = value.trim();
    if (!trimmed || trimmed === settings.libraryRoot) {
      setLibraryRoot(settings.libraryRoot);
      return;
    }
    if (relocateInspectingRef.current || relocateBusy) return;

    setError(null);
    relocateInspectingRef.current = true;
    try {
      const info = await inspectLibraryDestination(trimmed);
      setLibraryRoot(info.path);
      if (info.blockedReason) {
        setError(info.blockedReason);
        setLibraryRoot(settings.libraryRoot);
        setRelocateInfo(null);
        return;
      }
      setRelocateInfo(info);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setLibraryRoot(settings.libraryRoot);
    } finally {
      relocateInspectingRef.current = false;
    }
  };

  const confirmRelocate = async (mode: LibraryRelocateMode) => {
    if (!relocateInfo) return;
    setRelocateBusy(true);
    setError(null);
    try {
      // Stop before the root/DB change so mid-playback audio cannot keep
      // reading the previous library while relocate runs (issue #159).
      stopPlaybackForLibraryRelocate();
      const next = await relocateLibrary(relocateInfo.path, mode);
      applyLibrarySettings(next);
      setLibraryRoot(next.libraryRoot);
      try {
        await reloadAfterRelocate();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(`Library moved, but reload failed: ${message}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      const current = useLibrarySettingsStore.getState().settings;
      setLibraryRoot(current?.libraryRoot ?? settings.libraryRoot);
      throw err;
    } finally {
      setRelocateBusy(false);
    }
  };

  const commitOrganizePathFormat = (value: string = organizePathFormat) => {
    if (value === settings.organizePathFormat) return;
    patchSettings({ organizePathFormat: value });
  };

  const flushTextFields = () => {
    const current = useLibrarySettingsStore.getState().settings;
    if (!current) return;
    if (
      organizePathFormat !== current.organizePathFormat &&
      !relocateInfo &&
      !relocateBusy
    ) {
      patchSettings({ organizePathFormat });
    }
    // Discard unconfirmed library-root edits when closing preferences.
    if (libraryRoot.trim() !== current.libraryRoot && !relocateInfo) {
      setLibraryRoot(current.libraryRoot);
    }
  };

  const handleClose = () => {
    flushTextFields();
    setOpen(false);
  };

  const browseLibraryFolder = async () => {
    const folder = await pickLibraryFolder();
    if (folder) {
      setLibraryRoot(folder);
      await beginLibraryRootChange(folder);
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

  const trimmedDefaultAuthorId = defaultAuthorId.trim();
  const defaultAuthorIdValid =
    trimmedDefaultAuthorId.length === 0 || isAuthorId(trimmedDefaultAuthorId);

  const persistDefaultAuthorId = async () => {
    if (savingDefaultAuthorId) return;
    if (!defaultAuthorIdValid) {
      setDefaultAuthorId(lastPersistedAuthorIdRef.current);
      return;
    }
    setSavingDefaultAuthorId(true);
    setError(null);
    try {
      const saved = await saveDefaultAuthorId(trimmedDefaultAuthorId);
      setDefaultAuthorId(saved);
      lastPersistedAuthorIdRef.current = saved;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setDefaultAuthorId(lastPersistedAuthorIdRef.current);
    } finally {
      setSavingDefaultAuthorId(false);
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
        onClose={handleClose}
        size="editor"
        panelClassName="preferences-modal"
        panelRef={panelRef}
        labelledBy={titleId}
      >
        <ModalHeader>
          <ModalTitle id={titleId}>Preferences</ModalTitle>
          <ModalCloseButton onClick={handleClose} />
        </ModalHeader>

        <ModalBody className="preferences__body">
          <SidebarFrame
            as="aside"
            aria-label="Preference categories"
            className="preferences__sidebar"
          >
            <SidebarList>
              {PREFERENCES_SECTIONS.map((item) => (
                <li key={item.id}>
                  <SidebarItem
                    icon={item.icon}
                    active={activeSection === item.id}
                    onClick={() => setActiveSection(item.id)}
                  >
                    {item.label}
                  </SidebarItem>
                </li>
              ))}
            </SidebarList>
          </SidebarFrame>

          <div className="preferences__content">
            {activeSection === "library" && (
              <div className="preferences__panel">
                <FormField
                  label="Library location"
                  description="Media files and the database are stored in this folder."
                >
                  <div className="preferences__path-row">
                    <TextInput
                      value={libraryRoot}
                      onChange={(e) => setLibraryRoot(e.target.value)}
                      onBlur={() => void beginLibraryRootChange()}
                      spellCheck={false}
                      disabled={relocateBusy}
                    />
                    <Button
                      size="sm"
                      onClick={() => void browseLibraryFolder()}
                      disabled={relocateBusy}
                    >
                      <IconOpenFolder />
                      Choose…
                    </Button>
                    <Button
                      size="sm"
                      disabled={
                        relocateBusy ||
                        libraryRoot === settings.defaultLibraryRoot
                      }
                      onClick={() => {
                        const next = settings.defaultLibraryRoot;
                        setLibraryRoot(next);
                        void beginLibraryRootChange(next);
                      }}
                    >
                      <IconReset />
                      Reset
                    </Button>
                  </div>
                </FormField>

                <Separator />

                <Checkbox
                  alignStart
                  className="preferences__checkbox"
                  checked={settings.autoOrganize}
                  onChange={(e) =>
                    patchSettings({ autoOrganize: e.target.checked })
                  }
                >
                  Automatically organize music in the media folder
                </Checkbox>

                <div className="preferences__organize-path">
                  <FormField
                    label="Path format"
                    description={
                      organizePreviewPath != null ? (
                        <span aria-live="polite">
                          <code>{organizePreviewPath}</code>
                        </span>
                      ) : undefined
                    }
                  >
                    <div className="preferences__path-row">
                      <TextInput
                        value={organizePathFormat}
                        disabled={!settings.autoOrganize}
                        onChange={(e) => setOrganizePathFormat(e.target.value)}
                        onBlur={() => commitOrganizePathFormat()}
                        spellCheck={false}
                      />
                      <Button
                        size="sm"
                        disabled={
                          !settings.autoOrganize ||
                          isDefaultOrganizePathFormat(organizePathFormat)
                        }
                        onClick={() => {
                          const next = settings.defaultOrganizePathFormat;
                          setOrganizePathFormat(next);
                          commitOrganizePathFormat(next);
                        }}
                      >
                        <IconReset />
                        Reset
                      </Button>
                    </div>
                  </FormField>
                  <p className="preferences__hint">
                    <span className="preferences__hint-label">
                      Placeholders:
                    </span>{" "}
                    <code>{"{albumArtist}"}</code>, <code>{"{artist}"}</code>,{" "}
                    <code>{"{album}"}</code>, <code>{"{title}"}</code>,{" "}
                    <code>{"{trackNumber:02}"}</code>,{" "}
                    <code>{"{discNumber:02}"}</code>, <code>{"{year}"}</code>,{" "}
                    <code>{"{genre}"}</code>, <code>{"{ext}"}</code>
                  </p>
                </div>

                <Separator />

                <FormField
                  label="When importing files…"
                  labelId={importModeLabelId}
                >
                  <RadioGroup
                    name="importMode"
                    value={settings.importMode}
                    onChange={(importMode) => patchSettings({ importMode })}
                    variant="button"
                    orientation="horizontal"
                    aria-labelledby={importModeLabelId}
                  >
                    {IMPORT_MODE_OPTIONS.map((opt) => (
                      <RadioGroupItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </RadioGroupItem>
                    ))}
                  </RadioGroup>
                </FormField>
              </div>
            )}

            {activeSection === "cd" && (
              <div className="preferences__panel">
                <FormField label="Encode CD audio to…">
                  <Select
                    value={
                      isKnownEncodingProfileId(settings.cdImportProfileId)
                        ? (settings.cdImportProfileId as EncodingProfileId)
                        : DEFAULT_CD_IMPORT_PROFILE_ID
                    }
                    onChange={(value) =>
                      patchSettings({ cdImportProfileId: value })
                    }
                    options={ENCODING_PROFILE_SELECT_OPTIONS}
                    aria-label="CD import encoding profile"
                  />
                </FormField>
              </div>
            )}

            {activeSection === "playback" && (
              <div className="preferences__panel">
                <Field orientation="horizontal">
                  <Checkbox
                    id="pref-crossfade-enabled"
                    checked={crossfadeEnabled}
                    onChange={(e) => setCrossfadeEnabled(e.target.checked)}
                  />
                  <FieldContent>
                    <FieldLabel htmlFor="pref-crossfade-enabled">
                      Crossfade between tracks
                    </FieldLabel>
                    <FieldDescription>
                      Crossfade applies between mp3, flac, aac, wav, and AAC m4a
                      tracks. OGG, Opus, ALAC, and CD transitions are not
                      supported and will instantly switch.
                    </FieldDescription>
                  </FieldContent>
                </Field>

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
              </div>
            )}

            {activeSection === "listening" && (
              <div className="preferences__panel">
                <Field orientation="horizontal">
                  <Checkbox
                    id="pref-listening-history"
                    checked={settings.listeningHistoryEnabled}
                    onChange={(e) =>
                      patchSettings({
                        listeningHistoryEnabled: e.target.checked,
                      })
                    }
                  />
                  <FieldContent>
                    <FieldLabel htmlFor="pref-listening-history">
                      Record listening history
                    </FieldLabel>
                    <FieldDescription>
                      Spiral can record listening history for play counts and
                      personal insights.{" "}
                      <strong>
                        Your history is yours, stored locally, and never shared
                        with Spiral.
                      </strong>
                    </FieldDescription>
                  </FieldContent>
                </Field>

                <div className="preferences__clear-history">
                  <Button
                    ref={clearHistoryTriggerRef}
                    variant="secondary"
                    className={
                      historyCleared
                        ? "preferences__action-btn preferences__action-btn--success"
                        : undefined
                    }
                    onClick={(e) =>
                      toggleClearRangeMenu(clearHistoryTriggerRef.current, {
                        keyboard: e.detail === 0,
                      })
                    }
                    disabled={clearingHistory}
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
                    focusFirstItem={clearRangeOpenedWithKeyboard}
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
              </div>
            )}

            {activeSection === "metadata" && (
              <div className="preferences__panel">
                <Field orientation="horizontal">
                  <Checkbox
                    id="pref-metadata-backups"
                    checked={settings.metadataBackupsEnabled}
                    onChange={(e) =>
                      patchSettings({
                        metadataBackupsEnabled: e.target.checked,
                      })
                    }
                  />
                  <FieldContent>
                    <FieldLabel htmlFor="pref-metadata-backups">
                      Keep backups before metadata edits
                    </FieldLabel>
                    <FieldDescription>
                      When you edit tags, Spiral can keep a copy of the original
                      file next to the track (e.g. <code>song.m4a.bak</code>).
                      This can help recover from accidental edits, or corrupted
                      files.
                    </FieldDescription>
                  </FieldContent>
                </Field>

                <FormField label="Retention (days)">
                  <TextInput
                    type="number"
                    min={1}
                    max={3650}
                    value={settings.metadataBackupRetentionDays}
                    disabled={!settings.metadataBackupsEnabled}
                    onChange={(e) => {
                      const n = Number.parseInt(e.target.value, 10);
                      if (!Number.isFinite(n)) return;
                      patchSettings({
                        metadataBackupRetentionDays: Math.min(
                          3650,
                          Math.max(1, n),
                        ),
                      });
                    }}
                  />
                  <FieldDescription>
                    Remove backups after the specified number of days.
                  </FieldDescription>
                </FormField>

                <Separator />

                <Field>
                  <FieldLabel htmlFor="pref-cd-metadata-fetch-mode">
                    Fetch album metadata when inserting a CD
                  </FieldLabel>
                  <RadioGroup
                    name="cdMetadataFetchMode"
                    value={settings.cdMetadataFetchMode}
                    onChange={(cdMetadataFetchMode) =>
                      patchSettings({ cdMetadataFetchMode })
                    }
                    variant="button"
                    orientation="horizontal"
                    aria-labelledby={cdMetadataFetchModeLabelId}
                  >
                    {CD_METADATA_FETCH_MODE_OPTIONS.map((opt) => (
                      <RadioGroupItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </RadioGroupItem>
                    ))}
                  </RadioGroup>
                  <FieldDescription>
                    Look up metadata from{" "}
                    <TextLink href="https://musicbrainz.org" target="_blank">
                      MusicBrainz
                    </TextLink>
                  </FieldDescription>
                </Field>

                <Separator />

                <Field orientation="horizontal">
                  <Checkbox
                    id="pref-lyrics-auto-fetch"
                    checked={settings.lyricsAutoFetchInLightbox}
                    onChange={(e) =>
                      patchSettings({
                        lyricsAutoFetchInLightbox: e.target.checked,
                      })
                    }
                  />
                  <FieldContent>
                    <FieldLabel htmlFor="pref-lyrics-auto-fetch">
                      Automatically fetch lyrics in lightbox mode
                    </FieldLabel>
                    <FieldDescription>
                      Look up lyrics from{" "}
                      <TextLink href="https://lrclib.net" target="_blank">
                        LRCLIB
                      </TextLink>
                      .
                    </FieldDescription>
                  </FieldContent>
                </Field>

                <Field orientation="horizontal">
                  <Checkbox
                    id="pref-lyrics-sidecar"
                    checked={settings.lyricsSidecarSyncEnabled}
                    onChange={(e) =>
                      patchSettings({
                        lyricsSidecarSyncEnabled: e.target.checked,
                      })
                    }
                  />
                  <FieldContent>
                    <FieldLabel htmlFor="pref-lyrics-sidecar">
                      Sync timed lyrics to LRC sidecar files
                    </FieldLabel>
                    <FieldDescription>
                      <code>.lrc</code> files are kept next to track files.
                    </FieldDescription>
                  </FieldContent>
                </Field>

                <Separator />

                <Button
                  variant="secondary"
                  className={
                    metadataCacheCleared
                      ? "preferences__action-btn preferences__action-btn--success"
                      : "preferences__action-btn"
                  }
                  onClick={() => void handleClearMetadataCache()}
                  disabled={clearingMetadataCache}
                >
                  {clearingMetadataCache ? (
                    "Clearing…"
                  ) : metadataCacheCleared ? (
                    <>
                      <IconCheck aria-hidden />
                      Cache cleared
                    </>
                  ) : (
                    "Clear remote metadata cache"
                  )}
                </Button>
              </div>
            )}

            {activeSection === "studio" && (
              <div className="preferences__panel">
                <FormField
                  label="Default Author ID"
                  description={
                    defaultAuthorId.length > 0 && !defaultAuthorIdValid
                      ? "Use lowercase letters, numbers, and hyphens (e.g. jane-doe)."
                      : "Seeded into new workshop packs as authorId. Changing this does not rewrite existing packs."
                  }
                >
                  <TextInput
                    value={defaultAuthorId}
                    onChange={(e) => setDefaultAuthorId(e.target.value)}
                    onBlur={() => void persistDefaultAuthorId()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void persistDefaultAuthorId();
                      }
                    }}
                    placeholder="jane-doe"
                    spellCheck={false}
                    autoComplete="off"
                    disabled={!defaultAuthorIdLoaded || savingDefaultAuthorId}
                  />
                </FormField>
              </div>
            )}

            {activeSection === "updates" && (
              <div className="preferences__panel">
                <Field orientation="horizontal">
                  <Checkbox
                    id="pref-automatic-updates"
                    checked={automaticChecksEnabled}
                    onChange={(e) => {
                      void setAutomaticChecksEnabled(e.target.checked);
                    }}
                  />
                  <FieldContent>
                    <FieldLabel htmlFor="pref-automatic-updates">
                      {t("preferences:updates.automatic.label")}
                    </FieldLabel>
                    <FieldDescription>
                      {t("preferences:updates.automatic.description")}
                    </FieldDescription>
                  </FieldContent>
                </Field>

                {availableUpdate ? (
                  <p className="preferences__hint" role="status">
                    {t("preferences:updates.pending", {
                      version: availableUpdate.version,
                    })}
                  </p>
                ) : null}

                <Button
                  variant="secondary"
                  className="preferences__action-btn"
                  disabled={
                    updaterStatus === "checking" ||
                    updaterStatus === "downloading"
                  }
                  onClick={() => {
                    void checkForUpdates({ reason: "manual" });
                  }}
                >
                  <IconRefresh aria-hidden />
                  {updaterStatus === "checking"
                    ? t("common:updates.checking")
                    : t("preferences:updates.checkButton")}
                </Button>
              </div>
            )}

            {error && (
              <div className="preferences__status">
                <p className="preferences__error" role="alert">
                  {error}
                </p>
              </div>
            )}
          </div>
        </ModalBody>
      </Modal>

      <LibraryRelocateDialog
        open={relocateInfo != null}
        title={
          relocateInfo?.hasDatabase
            ? "Switch library location?"
            : relocateInfo && relocateInfo.audioFileCount > 0
              ? "Change library location?"
              : "Move library?"
        }
        primary={
          relocateInfo?.hasDatabase
            ? { label: "Switch to this library", mode: "switch" }
            : { label: "Move library here", mode: "move" }
        }
        secondary={
          relocateInfo?.hasDatabase
            ? undefined
            : relocateInfo && relocateInfo.audioFileCount > 0
              ? {
                  label: `Import ${relocateInfo.audioFileCount} found file${
                    relocateInfo.audioFileCount === 1 ? "" : "s"
                  }`,
                  mode: "freshImport",
                }
              : { label: "Start empty library", mode: "fresh" }
        }
        busy={relocateBusy}
        onClose={() => {
          if (relocateBusy) return;
          setRelocateInfo(null);
          const current = useLibrarySettingsStore.getState().settings;
          setLibraryRoot(current?.libraryRoot ?? settings.libraryRoot);
        }}
        onConfirm={confirmRelocate}
      >
        {relocateInfo?.hasDatabase ? (
          <p>
            A Spiral library already exists here. Your current library will stay
            at its old location.
          </p>
        ) : relocateInfo && relocateInfo.audioFileCount > 0 ? (
          <p>
            Found {relocateInfo.audioFileCount} audio file
            {relocateInfo.audioFileCount === 1 ? "" : "s"} at{" "}
            <code>{relocateInfo.path}</code>. Move your current library here, or
            start a new library and import those files in place.
          </p>
        ) : (
          <p>Or start a new empty library here.</p>
        )}
      </LibraryRelocateDialog>

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
        <p>All personal insights will be permanently lost.</p>
      </AlertConfirmation>
    </>
  );
}
