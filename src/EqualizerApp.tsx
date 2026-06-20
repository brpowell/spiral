import { EqualizerShell } from "./components/Equalizer/EqualizerShell";
import { useEqualizerWindowClose } from "./hooks/useEqualizerWindowClose";
import "./EqualizerApp.css";

export function EqualizerApp() {
  useEqualizerWindowClose();

  return (
    <div className="equalizer-app">
      <EqualizerShell />
    </div>
  );
}
