import { EqualizerShell } from "./components/Equalizer/EqualizerShell";
import { CustomWindowFrame } from "./components/WindowChrome/CustomWindowFrame";
import { useEqualizerWindowClose } from "./hooks/useEqualizerWindowClose";
import "./EqualizerApp.css";

export function EqualizerApp() {
  useEqualizerWindowClose();

  return (
    <CustomWindowFrame
      title="Equalizer"
      className="equalizer-app"
      showMaximize={false}
    >
      <EqualizerShell />
    </CustomWindowFrame>
  );
}
