import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { BackgroundTasksIndicator } from "./components/BackgroundTasks/BackgroundTasksIndicator";
import { ImportDropZone } from "./components/ImportDropZone/ImportDropZone";
import { PlayerDock } from "./components/PlayerDock/PlayerDock";
import { AlbumEditor } from "./components/AlbumEditor/AlbumEditor";
import { ArtistEditor } from "./components/ArtistEditor/ArtistEditor";
import { TrackEditor } from "./components/TrackEditor/TrackEditor";
import { MainContent } from "./components/layout/MainContent";
import { Sidebar } from "./components/layout/Sidebar";
import { Button } from "./components/common/Button/Button";
import { CopyButton } from "./components/common/CopyButton/CopyButton";
import { IconClose } from "./components/icons";
import { ImportChoiceModal } from "./components/ImportChoiceModal/ImportChoiceModal";
import { ImportDedupeModal } from "./components/ImportDedupeModal/ImportDedupeModal";
import { ConvertConfirmModal } from "./components/ConvertConfirmModal/ConvertConfirmModal";
import { CdImportCancelDialog } from "./components/CdImportCancelDialog/CdImportCancelDialog";
import { CdMetadataPicker } from "./components/CdMetadataPicker/CdMetadataPicker";
import { CdMusicBrainzFetchModal } from "./components/CdMusicBrainzFetchModal/CdMusicBrainzFetchModal";
import { PlaylistEditorModal } from "./components/PlaylistEditorModal/PlaylistEditorModal";
import { PreferencesModal } from "./components/PreferencesModal/PreferencesModal";
import { SpiralCardModal } from "./components/SpiralCardModal/SpiralCardModal";
import { ReplaceSpiralCardDialog } from "./components/SpiralCardModal/ReplaceSpiralCardDialog";
import { CrashReportModal } from "./components/ActivityLogs/CrashReportModal";
import { CustomWindowFrame } from "./components/WindowChrome/CustomWindowFrame";
import { useStartupCrashReport } from "./hooks/useStartupCrashReport";
import { usePlaylistStore } from "./store/usePlaylistStore";
import { useArtistImageStore } from "./store/useArtistImageStore";
import { setupAppMenu, type AppMenuHandlers } from "./lib/appMenu";
import { fetchMissingLyrics } from "./lib/fetchMissingLyrics";
import { refreshLibraryMetadata } from "./lib/refreshLibraryMetadata";
import { openSkinMode, quitApplication } from "./lib/skinModeWindow";
import { openActivityLogsWindow } from "./lib/activityLogsWindow";
import { openAppearanceWindow } from "./lib/appearanceWindow";
import { openEqualizerWindow } from "./lib/equalizerWindow";
import { reloadLinkedPacksWithRefresh } from "./lib/packs/refreshPackStores";
import { usesCustomWindowChrome } from "./lib/windowChrome";
import { SPCARD_OPENED_EVENT, takePendingSpcardOpens } from "./lib/tauri";
import { requestSpcardInstall } from "./lib/spcardInstall";
import { useAudioWakeRecovery } from "./hooks/useAudioWakeRecovery";
import { useHiddenPlaybackKeepAlive } from "./hooks/useHiddenPlaybackKeepAlive";
import { useCdMonitor } from "./hooks/useCdMonitor";
import { useMediaHotkeys } from "./hooks/useMediaHotkeys";
import { loadTrackListPreferences } from "./components/TrackList/trackListPreferences";
import { usePlaybackSessionPersistence } from "./hooks/usePlaybackSessionPersistence";
import { useMediaSessionSync } from "./hooks/useMediaSessionSync";
import { useVisualizerDataProvider } from "./hooks/useVisualizerDataProvider";
import { useLibrarySettingsStore } from "./store/useLibrarySettingsStore";
import { useLicenseStore } from "./store/useLicenseStore";
import { usePlayerStore } from "./store/usePlayerStore";
import { useUpdaterStore } from "./store/useUpdaterStore";
import "./App.css";

const showCustomWindowChrome = usesCustomWindowChrome();

function App() {
  const loadLibrary = usePlayerStore((s) => s.loadLibrary);
  const loadPlaylists = usePlaylistStore((s) => s.loadPlaylists);
  const loadArtistImages = useArtistImageStore((s) => s.loadArtistImages);
  const openPlaylistEditor = usePlaylistStore((s) => s.openPlaylistEditor);
  const addToLibrary = usePlayerStore((s) => s.addToLibrary);
  const loadSettings = useLibrarySettingsStore((s) => s.loadSettings);
  const setPreferencesOpen = useLibrarySettingsStore(
    (s) => s.setPreferencesOpen,
  );
  const loadLicense = useLicenseStore((s) => s.loadLicense);
  const openSpiralCard = useLicenseStore((s) => s.openSpiralCard);
  const importError = usePlayerStore((s) => s.importError);
  const clearImportError = usePlayerStore((s) => s.clearImportError);
  const applyAutomaticChecksEnabled = useUpdaterStore(
    (s) => s.applyAutomaticChecksEnabled,
  );
  const startAutomaticUpdateChecks = useUpdaterStore(
    (s) => s.startAutomaticUpdateChecks,
  );
  const {
    open: crashModalOpen,
    report: crashReport,
    crashReportId,
    dismiss: dismissCrashReport,
  } = useStartupCrashReport();

  useMediaHotkeys();
  useAudioWakeRecovery();
  useHiddenPlaybackKeepAlive();
  useCdMonitor();
  usePlaybackSessionPersistence();
  useVisualizerDataProvider();
  useMediaSessionSync();

  const menuHandlers: AppMenuHandlers = {
    addToLibrary: () => {
      void addToLibrary();
    },
    refreshLibraryMetadata: () => {
      void refreshLibraryMetadata();
    },
    fetchMissingLyrics: () => {
      fetchMissingLyrics();
    },
    newPlaylist: () => openPlaylistEditor("new"),
    openPreferences: () => setPreferencesOpen(true),
    openSpiralCard: () => openSpiralCard(),
    checkForUpdates: () => {
      void useUpdaterStore.getState().checkForUpdates({ reason: "manual" });
    },
    openSkinMode: () => {
      void openSkinMode();
    },
    openAppearance: () => {
      void openAppearanceWindow();
    },
    openEqualizer: () => {
      void openEqualizerWindow();
    },
    openActivityLogs: () => {
      void openActivityLogsWindow();
    },
    reloadLinkedPacks: () => {
      void reloadLinkedPacksWithRefresh();
    },
    quit: () => {
      void quitApplication();
    },
  };

  useEffect(() => {
    let cancelled = false;
    let stopAutomaticChecks: (() => void) | undefined;

    void loadSettings().then((settings) => {
      if (cancelled) return;
      applyAutomaticChecksEnabled(settings.automaticUpdateChecksEnabled);
      stopAutomaticChecks = startAutomaticUpdateChecks();
    });
    void loadTrackListPreferences();
    void loadLicense().then(async () => {
      const paths = await takePendingSpcardOpens();
      for (const path of paths) {
        await requestSpcardInstall(path);
      }
      if (!useLicenseStore.getState().pendingReplacePath) {
        useLicenseStore.getState().maybeOpenReadyToFinalizePrompt();
      }
    });
    loadLibrary();
    void loadPlaylists();
    void loadArtistImages();

    return () => {
      cancelled = true;
      stopAutomaticChecks?.();
    };
  }, [
    loadLibrary,
    loadSettings,
    loadLicense,
    loadPlaylists,
    loadArtistImages,
    applyAutomaticChecksEnabled,
    startAutomaticUpdateChecks,
  ]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void listen<string[]>(SPCARD_OPENED_EVENT, (event) => {
      const paths = event.payload ?? [];
      for (const path of paths) {
        void requestSpcardInstall(path);
      }
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (showCustomWindowChrome) return;
    void setupAppMenu(menuHandlers);
    // menuHandlers is a fresh object each render; store actions in the dep list
    // are stable and cover the callbacks that actually change.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- avoid rebinding the native menu every render
  }, [addToLibrary, openPlaylistEditor, setPreferencesOpen, openSpiralCard]);

  // Native setAsAppMenu accelerators don't apply under custom chrome.
  useEffect(() => {
    if (!showCustomWindowChrome) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();

      if (key === "," && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        setPreferencesOpen(true);
        return;
      }
      if (key === "l" && e.shiftKey && !e.altKey) {
        e.preventDefault();
        void openActivityLogsWindow();
        return;
      }
      if (key === "r" && e.altKey && !e.shiftKey) {
        e.preventDefault();
        void reloadLinkedPacksWithRefresh();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setPreferencesOpen]);

  return (
    <CustomWindowFrame title="Spiral" handlers={menuHandlers} className="app">
      <header className="app-header">
        <PlayerDock />
      </header>

      {importError && (
        <div className="error-banner" role="alert">
          <span className="error-banner__message">{importError}</span>
          <div className="error-banner__actions">
            <CopyButton
              text={importError}
              aria-label="Copy error message"
              copiedAriaLabel="Copied error message"
              title="Copy error message"
            />
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              onClick={clearImportError}
              aria-label="Dismiss"
              title="Dismiss"
            >
              <IconClose />
            </Button>
          </div>
        </div>
      )}

      <div className="app-body">
        <Sidebar />
        <MainContent />
      </div>

      <TrackEditor />
      <AlbumEditor />
      <ArtistEditor />
      <PlaylistEditorModal />
      <ImportDropZone />
      <PreferencesModal />
      <SpiralCardModal />
      <ReplaceSpiralCardDialog />
      <ImportChoiceModal />
      <ImportDedupeModal />
      <ConvertConfirmModal />
      <CdMusicBrainzFetchModal />
      <CdMetadataPicker />
      <CdImportCancelDialog />
      <CrashReportModal
        open={crashModalOpen}
        report={crashReport}
        crashReportId={crashReportId}
        onDismiss={dismissCrashReport}
      />
      <BackgroundTasksIndicator />
    </CustomWindowFrame>
  );
}

export default App;
