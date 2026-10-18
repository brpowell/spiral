import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
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
  getDefaultPublisherId,
  saveDefaultPublisherId,
} from "../../lib/tauri";
import { stopPlaybackForLibraryRelocate } from "../../lib/libraryRelocatePlayback";
import { isPublisherId } from "../../lib/items/itemIds";
import { useArtistImageStore } from "../../store/useArtistImageStore";
import { useLibrarySettingsStore } from "../../store/useLibrarySettingsStore";
import { usePlaybackSettingsStore } from "../../store/usePlaybackSettingsStore";
import { usePlayerStore } from "../../store/usePlayerStore";
import { usePlaylistStore } from "../../store/usePlaylistStore";
import { useUpdaterStore } from "../../store/useUpdaterStore";
import { useItemUpdatesStore } from "../../store/useItemUpdatesStore";
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
  const automaticItemChecksEnabled = useItemUpdatesStore(
    (s) => s.automaticItemChecksEnabled,
  );
  const setAutomaticItemChecksEnabled = useItemUpdatesStore(
    (s) => s.setAutomaticItemChecksEnabled,
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
  const [defaultPublisherId, setDefaultPublisherId] = useState("");
  const [defaultPublisherIdLoaded, setDefaultPublisherIdLoaded] =
    useState(false);
  const [savingDefaultPublisherId, setSavingDefaultPublisherId] =
    useState(false);
  const lastPersistedPublisherIdRef = useRef("");

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
    setDefaultPublisherIdLoaded(false);
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
    if (!open || activeSection !== "studio" || defaultPublisherIdLoaded) return;
    let cancelled = false;
    void getDefaultPublisherId()
      .then((id) => {
        if (!cancelled) {
          setDefaultPublisherId(id);
          lastPersistedPublisherIdRef.current = id;
          setDefaultPublisherIdLoaded(true);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          console.error("Failed to load default publisher id:", err);
          setDefaultPublisherIdLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, activeSection, defaultPublisherIdLoaded]);

  const organizePreviewPath = useMemo(() => {
    if (!settings) return null;
    return formatOrganizeRelativePath(organizePathFormat, previewSample);
  }, [settings, organizePathFormat, previewSample]);

  if (!settings) return null;

  const IMPORT_MODE_OPTIONS: { value: ImportMode; label: string }[] = [
    { value: "copy", label: t("preferences:library.importCopy") },
    { value: "reference", label: t("preferences:library.importReference") },
    { value: "ask", label: t("preferences:library.importAsk") },
  ];

  const CD_METADATA_FETCH_MODE_OPTIONS: {
    value: CdMetadataFetchMode;
    label: string;
  }[] = [
    { value: "always", label: t("preferences:metadata.cdFetchAlways") },
    { value: "ask", label: t("preferences:metadata.cdFetchAsk") },
    { value: "never", label: t("preferences:metadata.cdFetchNever") },
  ];

  /** Browser-style clear ranges: hours to delete, or null for all time. */
  const CLEAR_HISTORY_RANGES: { withinHours: number | null; label: string }[] =
    [
      { withinHours: 1, label: t("preferences:listening.rangeHour") },
      { withinHours: 24, label: t("preferences:listening.rangeDay") },
      { withinHours: 24 * 7, label: t("preferences:listening.rangeWeek") },
      { withinHours: 24 * 7 * 4, label: t("preferences:listening.rangeMonth") },
      { withinHours: null, label: t("preferences:listening.rangeAll") },
    ];

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
        setError(t("preferences:library.reloadFailed", { message }));
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
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setClearingMetadataCache(false);
    }
  };

  const trimmedDefaultPublisherId = defaultPublisherId.trim();
  const defaultPublisherIdValid =
    trimmedDefaultPublisherId.length === 0 ||
    isPublisherId(trimmedDefaultPublisherId);

  const persistDefaultPublisherId = async () => {
    if (savingDefaultPublisherId) return;
    if (!defaultPublisherIdValid) {
      setDefaultPublisherId(lastPersistedPublisherIdRef.current);
      return;
    }
    setSavingDefaultPublisherId(true);
    setError(null);
    try {
      const saved = await saveDefaultPublisherId(trimmedDefaultPublisherId);
      setDefaultPublisherId(saved);
      lastPersistedPublisherIdRef.current = saved;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setDefaultPublisherId(lastPersistedPublisherIdRef.current);
    } finally {
      setSavingDefaultPublisherId(false);
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
          <ModalTitle id={titleId}>{t("preferences:title")}</ModalTitle>
          <ModalCloseButton onClick={handleClose} />
        </ModalHeader>

        <ModalBody className="preferences__body">
          <SidebarFrame
            as="aside"
            aria-label={t("preferences:categoriesAria")}
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
                  label={t("preferences:library.location")}
                  description={t("preferences:library.locationDescription")}
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
                      {t("common:chooseEllipsis")}
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
                      {t("common:reset")}
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
                  {t("preferences:library.autoOrganize")}
                </Checkbox>

                <div className="preferences__organize-path">
                  <FormField
                    label={t("preferences:library.pathFormat")}
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
                        {t("common:reset")}
                      </Button>
                    </div>
                  </FormField>
                  <p className="preferences__hint">
                    <span className="preferences__hint-label">
                      {t("preferences:library.placeholders")}
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
                  label={t("preferences:library.importMode")}
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
                <FormField label={t("preferences:cd.encodeTo")}>
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
                    aria-label={t("preferences:cd.encodeAria")}
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
                      {t("preferences:playback.crossfade.enabled")}
                    </FieldLabel>
                    <FieldDescription>
                      {t("preferences:playback.crossfade.description")}
                    </FieldDescription>
                  </FieldContent>
                </Field>

                <FormField label={t("preferences:playback.crossfade.duration")}>
                  <Slider
                    min={MIN_CROSSFADE_SECONDS}
                    max={MAX_CROSSFADE_SECONDS}
                    step={1}
                    value={crossfadeSeconds}
                    disabled={!crossfadeEnabled}
                    onChange={(e) =>
                      setCrossfadeSeconds(Number.parseInt(e.target.value, 10))
                    }
                    aria-label={t(
                      "preferences:playback.crossfade.durationAria",
                    )}
                    showValueTooltip
                    formatValueTooltip={(value) =>
                      t("preferences:playback.crossfade.durationValue", {
                        value,
                      })
                    }
                  />
                </FormField>

                <Checkbox
                  alignStart
                  className="preferences__checkbox"
                  checked={crossfadeOnSkip}
                  disabled={!crossfadeEnabled}
                  onChange={(e) => setCrossfadeOnSkip(e.target.checked)}
                >
                  {t("preferences:playback.crossfade.onSkip")}
                </Checkbox>

                <Checkbox
                  alignStart
                  className="preferences__checkbox"
                  checked={crossfadeVisualEnabled}
                  disabled={!crossfadeEnabled}
                  onChange={(e) => setCrossfadeVisualEnabled(e.target.checked)}
                >
                  {t("preferences:playback.crossfade.visual")}
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
                      {t("preferences:listening.record")}
                    </FieldLabel>
                    <FieldDescription>
                      <Trans
                        i18nKey="listening.description"
                        ns="preferences"
                        components={{ strong: <strong /> }}
                      />
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
                      t("preferences:listening.clearing")
                    ) : historyCleared ? (
                      <>
                        <IconCheck aria-hidden />
                        {t("preferences:listening.cleared")}
                      </>
                    ) : (
                      <>
                        {t("preferences:listening.clear")}
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
                          key={range.withinHours ?? "all"}
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
                <Field>
                  <FieldLabel htmlFor="pref-cd-metadata-fetch-mode">
                    {t("preferences:metadata.cdFetch")}
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
                    <Trans
                      i18nKey="metadata.cdFetchDescription"
                      ns="preferences"
                      components={{
                        musicBrainz: (
                          <TextLink
                            href="https://musicbrainz.org"
                            target="_blank"
                          />
                        ),
                      }}
                    />
                  </FieldDescription>
                </Field>

                <Field orientation="horizontal">
                  <Checkbox
                    id="pref-confirm-mb-links"
                    checked={settings.confirmMusicBrainzExternalLinks ?? true}
                    onChange={(e) =>
                      patchSettings({
                        confirmMusicBrainzExternalLinks: e.target.checked,
                      })
                    }
                  />
                  <FieldContent>
                    <FieldLabel htmlFor="pref-confirm-mb-links">
                      {t("preferences:metadata.confirmMusicBrainzLinks")}
                    </FieldLabel>
                    <FieldDescription>
                      {t(
                        "preferences:metadata.confirmMusicBrainzLinksDescription",
                      )}
                    </FieldDescription>
                  </FieldContent>
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
                      {t("preferences:metadata.lyricsAutoFetch")}
                    </FieldLabel>
                    <FieldDescription>
                      <Trans
                        i18nKey="metadata.lyricsAutoFetchDescription"
                        ns="preferences"
                        components={{
                          lrclib: (
                            <TextLink
                              href="https://lrclib.net"
                              target="_blank"
                            />
                          ),
                        }}
                      />
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
                      {t("preferences:metadata.lyricsSidecar")}
                    </FieldLabel>
                    <FieldDescription>
                      <Trans
                        i18nKey="metadata.lyricsSidecarDescription"
                        ns="preferences"
                        components={{ code: <code /> }}
                      />
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
                    t("preferences:metadata.clearingCache")
                  ) : metadataCacheCleared ? (
                    <>
                      <IconCheck aria-hidden />
                      {t("preferences:metadata.cacheCleared")}
                    </>
                  ) : (
                    t("preferences:metadata.clearCache")
                  )}
                </Button>
              </div>
            )}

            {activeSection === "studio" && (
              <div className="preferences__panel">
                <FormField
                  label={t("preferences:studio.defaultPublisherId")}
                  description={
                    defaultPublisherId.length > 0 && !defaultPublisherIdValid
                      ? t("preferences:studio.slugHint")
                      : t("preferences:studio.defaultPublisherIdDescription")
                  }
                >
                  <TextInput
                    value={defaultPublisherId}
                    onChange={(e) => setDefaultPublisherId(e.target.value)}
                    onBlur={() => void persistDefaultPublisherId()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void persistDefaultPublisherId();
                      }
                    }}
                    placeholder={t("preferences:studio.publisherIdPlaceholder")}
                    spellCheck={false}
                    autoComplete="off"
                    disabled={
                      !defaultPublisherIdLoaded || savingDefaultPublisherId
                    }
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

                <Field orientation="horizontal">
                  <Checkbox
                    id="pref-automatic-item-updates"
                    checked={automaticItemChecksEnabled}
                    onChange={(e) => {
                      void setAutomaticItemChecksEnabled(e.target.checked);
                    }}
                  />
                  <FieldContent>
                    <FieldLabel htmlFor="pref-automatic-item-updates">
                      {t("preferences:updates.automaticItems.label")}
                    </FieldLabel>
                    <FieldDescription>
                      {t("preferences:updates.automaticItems.description")}
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
            ? t("preferences:relocate.switchTitle")
            : relocateInfo && relocateInfo.audioFileCount > 0
              ? t("preferences:relocate.changeTitle")
              : t("preferences:relocate.moveTitle")
        }
        primary={
          relocateInfo?.hasDatabase
            ? { label: t("preferences:relocate.switchPrimary"), mode: "switch" }
            : { label: t("preferences:relocate.movePrimary"), mode: "move" }
        }
        secondary={
          relocateInfo?.hasDatabase
            ? undefined
            : relocateInfo && relocateInfo.audioFileCount > 0
              ? {
                  label: t("preferences:relocate.importFound", {
                    count: relocateInfo.audioFileCount,
                  }),
                  mode: "freshImport",
                }
              : { label: t("preferences:relocate.freshPrimary"), mode: "fresh" }
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
          <p>{t("preferences:relocate.hasDatabase")}</p>
        ) : relocateInfo && relocateInfo.audioFileCount > 0 ? (
          <p>
            <Trans
              i18nKey="relocate.foundFiles"
              ns="preferences"
              count={relocateInfo.audioFileCount}
              values={{
                count: relocateInfo.audioFileCount,
                path: relocateInfo.path,
              }}
              components={{ code: <code /> }}
            />
          </p>
        ) : (
          <p>{t("preferences:relocate.empty")}</p>
        )}
      </LibraryRelocateDialog>

      <AlertConfirmation
        open={clearHistoryOpen}
        onClose={() => {
          if (clearingHistory) return;
          setClearHistoryOpen(false);
        }}
        title={t("preferences:listening.clearAllTitle")}
        confirmLabel={
          clearingHistory
            ? t("preferences:listening.clearing")
            : t("preferences:listening.clearAllConfirm")
        }
        onConfirm={() => handleClearListeningHistory(null)}
      >
        <p>{t("preferences:listening.clearAllBody")}</p>
      </AlertConfirmation>
    </>
  );
}
