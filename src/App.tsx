import { useEffect } from "react";
import { BackgroundTasksIndicator } from "./components/BackgroundTasks/BackgroundTasksIndicator";
import { ImportDropZone } from "./components/ImportDropZone/ImportDropZone";
import { PlayerDock } from "./components/PlayerDock/PlayerDock";
import { AlbumEditor } from "./components/AlbumEditor/AlbumEditor";
import { TrackEditor } from "./components/TrackEditor/TrackEditor";
import { MainContent } from "./components/layout/MainContent";
import { Sidebar } from "./components/layout/Sidebar";
import { Button } from "./components/Button/Button";
import { ImportChoiceModal } from "./components/ImportChoiceModal/ImportChoiceModal";
import { PreferencesModal } from "./components/PreferencesModal/PreferencesModal";
import { setupAppMenu } from "./lib/appMenu";
import { useMediaHotkeys } from "./hooks/useMediaHotkeys";
import { loadTrackListPreferences } from "./components/TrackList/trackListPreferences";
import { usePlaybackSessionPersistence } from "./hooks/usePlaybackSessionPersistence";
import { useLibrarySettingsStore } from "./store/useLibrarySettingsStore";
import { usePlayerStore } from "./store/usePlayerStore";
import "./App.css";

function App() {
  const loadLibrary = usePlayerStore((s) => s.loadLibrary);
  const addToLibrary = usePlayerStore((s) => s.addToLibrary);
  const loadSettings = useLibrarySettingsStore((s) => s.loadSettings);
  const setPreferencesOpen = useLibrarySettingsStore((s) => s.setPreferencesOpen);
  const importError = usePlayerStore((s) => s.importError);
  const clearImportError = usePlayerStore((s) => s.clearImportError);

  useMediaHotkeys();
  usePlaybackSessionPersistence();

  useEffect(() => {
    void loadSettings();
    void loadTrackListPreferences();
    loadLibrary();
  }, [loadLibrary, loadSettings]);

  useEffect(() => {
    void setupAppMenu({
      addToLibrary: () => {
        void addToLibrary();
      },
      openPreferences: () => setPreferencesOpen(true),
    });
  }, [addToLibrary, setPreferencesOpen]);

  return (
    <div className="app">
      <header className="app-header">
        <PlayerDock />
      </header>

      {importError && (
        <div className="error-banner" role="alert">
          <span>{importError}</span>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            onClick={clearImportError}
            aria-label="Dismiss"
          >
            ×
          </Button>
        </div>
      )}

      <div className="app-body">
        <Sidebar />
        <MainContent />
      </div>

      <TrackEditor />
      <AlbumEditor />
      <ImportDropZone />
      <PreferencesModal />
      <ImportChoiceModal />
      <BackgroundTasksIndicator />
    </div>
  );
}

export default App;
