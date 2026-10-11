import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { BackgroundTasksIndicator } from "./components/BackgroundTasks/BackgroundTasksIndicator";
import { ImportDropZone } from "./components/ImportDropZone/ImportDropZone";
import { PlayerDock } from "./components/PlayerDock/PlayerDock";
import { AlbumEditor } from "./components/AlbumEditor/AlbumEditor";
import { ArtistEditor } from "./components/ArtistEditor/ArtistEditor";
import { CdAlbumEditor } from "./components/CdAlbumEditor/CdAlbumEditor";
import { CdTrackEditor } from "./components/CdTrackEditor/CdTrackEditor";
import { TrackEditor } from "./components/TrackEditor/TrackEditor";
import { LyricsReviewQueue } from "./components/LyricsReviewQueue/LyricsReviewQueue";
import { MainContent } from "./components/layout/MainContent";
import { Sidebar } from "./components/layout/Sidebar";
import { ImportChoiceModal } from "./components/ImportChoiceModal/ImportChoiceModal";
import { ImportDedupeModal } from "./components/ImportDedupeModal/ImportDedupeModal";
import { ConvertConfirmModal } from "./components/ConvertConfirmModal/ConvertConfirmModal";
import { CdImportCancelDialog } from "./components/CdImportCancelDialog/CdImportCancelDialog";
import { CdMetadataPicker } from "./components/CdMetadataPicker/CdMetadataPicker";
import { CdMusicBrainzFetchModal } from "./components/CdMusicBrainzFetchModal/CdMusicBrainzFetchModal";
import { PlaylistEditorModal } from "./components/PlaylistEditorModal/PlaylistEditorModal";
import { PreferencesModal } from "./components/PreferencesModal/PreferencesModal";
import { CrashReportModal } from "./components/ActivityLogs/CrashReportModal";
import { WhatsNewModal } from "./components/WhatsNewModal/WhatsNewModal";
import { CustomWindowFrame } from "./components/WindowChrome/CustomWindowFrame";
import { useStartupCrashReport } from "./hooks/useStartupCrashReport";
import { usePlaylistStore } from "./store/usePlaylistStore";
import { useArtistImageStore } from "./store/useArtistImageStore";
import { setupAppMenu, type AppMenuHandlers } from "./lib/appMenu";
import { toggleStubLocaleAndReload } from "./lib/appLocale";
import { t } from "./lib/i18n";
import { fetchMissingLyrics } from "./lib/fetchMissingLyrics";
import { refreshLibraryMetadata } from "./lib/refreshLibraryMetadata";
import { openSkinMode, quitApplication } from "./lib/skinModeWindow";
import { openActivityLogsWindow } from "./lib/activityLogsWindow";
import {
  openAppearanceWindow,
  PACK_UPDATES_CHANGED_EVENT,
} from "./lib/appearanceWindow";
import { openAboutWindow } from "./lib/aboutWindow";
import { openEqualizerWindow } from "./lib/equalizerWindow";
import { toggleToastLabWindow } from "./lib/toastLabWindow";
import { reloadLinkedPacksWithRefresh } from "./lib/packs/refreshPackStores";
import { usesCustomWindowChrome } from "./lib/windowChrome";
import { useAudioWakeRecovery } from "./hooks/useAudioWakeRecovery";
import { useHiddenPlaybackKeepAlive } from "./hooks/useHiddenPlaybackKeepAlive";
import { useCdMonitor } from "./hooks/useCdMonitor";
import { useMediaHotkeys } from "./hooks/useMediaHotkeys";
import { loadTrackListPreferences } from "./components/TrackList/trackListPreferences";
import { usePlaybackSessionPersistence } from "./hooks/usePlaybackSessionPersistence";
import { useMediaSessionSync } from "./hooks/useMediaSessionSync";
import { useVisualizerDataProvider } from "./hooks/useVisualizerDataProvider";
import { useLibrarySettingsStore } from "./store/useLibrarySettingsStore";
import { usePlayerStore } from "./store/usePlayerStore";
import { useUpdaterStore } from "./store/useUpdaterStore";
import { usePackUpdatesStore } from "./store/usePackUpdatesStore";
import type { CatalogPackEntry } from "./types/packRegistry";
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
  const applyAutomaticChecksEnabled = useUpdaterStore(
    (s) => s.applyAutomaticChecksEnabled,
  );
  const startAutomaticUpdateChecks = useUpdaterStore(
    (s) => s.startAutomaticUpdateChecks,
  );
  const applyAutomaticPackChecksEnabled = usePackUpdatesStore(
    (s) => s.applyAutomaticPackChecksEnabled,
  );
  const startAutomaticPackUpdateChecks = usePackUpdatesStore(
    (s) => s.startAutomaticPackUpdateChecks,
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
    checkForUpdates: () => {
      void useUpdaterStore.getState().checkForUpdates({ reason: "manual" });
    },
    openAbout: () => {
      void openAboutWindow();
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
    ...(import.meta.env.DEV
      ? {
          toggleToastLab: () => {
            void toggleToastLabWindow();
          },
          toggleSoundLab: () => {
            void import("./lib/soundLabWindow").then((mod) =>
              mod.toggleSoundLabWindow(),
            );
          },
          simulateMockUpdate: () => {
            useUpdaterStore.getState().simulateMockUpdate();
          },
          toggleStubLocale: () => {
            toggleStubLocaleAndReload();
          },
        }
      : {}),
  };

  useEffect(() => {
    let cancelled = false;
    let stopAutomaticChecks: (() => void) | undefined;
    let stopAutomaticPackChecks: (() => void) | undefined;

    void loadSettings().then((settings) => {
      if (cancelled) return;
      applyAutomaticChecksEnabled(settings.automaticUpdateChecksEnabled);
      applyAutomaticPackChecksEnabled(
        settings.automaticPackUpdateChecksEnabled,
      );
      stopAutomaticChecks = startAutomaticUpdateChecks();
      stopAutomaticPackChecks = startAutomaticPackUpdateChecks();
    });
    void loadTrackListPreferences();
    loadLibrary();
    void loadPlaylists();
    void loadArtistImages();

    return () => {
      cancelled = true;
      stopAutomaticChecks?.();
      stopAutomaticPackChecks?.();
    };
  }, [
    loadLibrary,
    loadSettings,
    loadPlaylists,
    loadArtistImages,
    applyAutomaticChecksEnabled,
    startAutomaticUpdateChecks,
    applyAutomaticPackChecksEnabled,
    startAutomaticPackUpdateChecks,
  ]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void listen<CatalogPackEntry[]>(PACK_UPDATES_CHANGED_EVENT, (event) => {
      usePackUpdatesStore.getState().applyPendingUpdates(event.payload ?? []);
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
  }, [addToLibrary, openPlaylistEditor, setPreferencesOpen]);

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
      if (import.meta.env.DEV && key === "t" && e.shiftKey && !e.altKey) {
        e.preventDefault();
        void toggleToastLabWindow();
        return;
      }
      if (import.meta.env.DEV && key === "s" && e.altKey && !e.shiftKey) {
        e.preventDefault();
        void import("./lib/soundLabWindow").then((mod) =>
          mod.toggleSoundLabWindow(),
        );
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
    <CustomWindowFrame
      title={t("menus:app.name")}
      handlers={menuHandlers}
      showTitle={false}
      className="app"
    >
      <header className="app-header">
        <PlayerDock />
      </header>

      <div className="app-body">
        <Sidebar />
        <MainContent />
      </div>

      <TrackEditor />
      <LyricsReviewQueue />
      <CdTrackEditor />
      <AlbumEditor />
      <CdAlbumEditor />
      <ArtistEditor />
      <PlaylistEditorModal />
      <ImportDropZone />
      <PreferencesModal />
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
      <WhatsNewModal />
      <BackgroundTasksIndicator />
    </CustomWindowFrame>
  );
}

export default App;
