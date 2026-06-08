import { useEffect } from "react";
import { SkinPickerPanel } from "./components/playback/SkinPicker/SkinPickerPanel";
import { Button } from "./components/common/Button/Button";
import { useSkinPickerWindowClose } from "./hooks/useSkinPickerWindowClose";
import { useSkinStore } from "./store/useSkinStore";
import "./SkinPickerApp.css";

export function SkinPickerApp() {
  useSkinPickerWindowClose();
  const loadSkins = useSkinStore((s) => s.loadSkins);
  const openSkinsFolder = useSkinStore((s) => s.openSkinsFolder);

  useEffect(() => {
    void loadSkins().catch((err: unknown) => {
      console.error("Failed to load skins in picker window:", err);
    });
  }, [loadSkins]);

  return (
    <div className="skin-picker-app">
      <header className="skin-picker-app__header">
        <h1 className="skin-picker-app__title">Skins</h1>
        <p className="skin-picker-app__subtitle">
          Choose a layout pack for skin mode.
        </p>
      </header>

      <main className="skin-picker-app__main">
        <SkinPickerPanel />
      </main>

      <footer className="skin-picker-app__footer">
        <Button variant="secondary" size="sm" onClick={() => void openSkinsFolder()}>
          Open skins folder
        </Button>
        <p className="skin-picker-app__footer-hint">
          Drop a folder with <code>skin.json</code> to add your own.
        </p>
      </footer>
    </div>
  );
}
