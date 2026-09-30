import { CustomWindowFrame } from "./components/WindowChrome/CustomWindowFrame";
import { SoundLabShell } from "./components/SoundLab/SoundLabShell";
import "./SoundLabApp.css";

export function SoundLabApp() {
  return (
    <CustomWindowFrame title="Sound Lab" className="sound-lab-app">
      <SoundLabShell />
    </CustomWindowFrame>
  );
}
