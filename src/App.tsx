import { useEffect } from "react";
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
import { usePlaylistStore } from "./store/usePlaylistStore";
import { useArtistImageStore } from "./store/useArtistImageStore";
import { setupAppMenu } from "./lib/appMenu";
import { refreshLibraryMetadata } from "./lib/refreshLibraryMetadata";
import { openSkinMode } from "./lib/skinModeWindow";
import { openActivityLogsWindow } from "./lib/activityLogsWindow";
import { openAppearanceWindow } from "./lib/appearanceWindow";
import { openEqualizerWindow } from "./lib/equalizerWindow";
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
import "./App.css";

function App() {
  const loadLibrary = usePlayerStore((s) => s.loadLibrary);
  const loadPlaylists = usePlaylistStore((s) => s.loadPlaylists);
  const loadArtistImages = useArtistImageStore((s) => s.loadArtistImages);
  const openPlaylistEditor = usePlaylistStore((s) => s.openPlaylistEditor);
  const addToLibrary = usePlayerStore((s) => s.addToLibrary);
  const loadSettings = useLibrarySettingsStore((s) => s.loadSettings);
  const setPreferencesOpen = useLibrarySettingsStore((s) => s.setPreferencesOpen);
  const importError = usePlayerStore((s) => s.importError);
  const clearImportError = usePlayerStore((s) => s.clearImportError);

  useMediaHotkeys();
  useAudioWakeRecovery();
  useHiddenPlaybackKeepAlive();
  useCdMonitor();
  usePlaybackSessionPersistence();
  useVisualizerDataProvider();
  useMediaSessionSync();

  useEffect(() => {
    void loadSettings();
    void loadTrackListPreferences();
    loadLibrary();
    void loadPlaylists();
    void loadArtistImages();
  }, [loadLibrary, loadSettings, loadPlaylists, loadArtistImages]);

  useEffect(() => {
    void setupAppMenu({
      addToLibrary: () => {
        void addToLibrary();
      },
      refreshLibraryMetadata: () => {
        void refreshLibraryMetadata();
      },
      newPlaylist: () => openPlaylistEditor("new"),
      openPreferences: () => setPreferencesOpen(true),
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
    });
  }, [addToLibrary, openPlaylistEditor, setPreferencesOpen]);

  return (
    <div className="app">
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
      <ImportChoiceModal />
      <ImportDedupeModal />
      <ConvertConfirmModal />
      <CdMusicBrainzFetchModal />
      <CdMetadataPicker />
      <CdImportCancelDialog />
      <BackgroundTasksIndicator />
    </div>
  );
}

export default App;
