import { CustomWindowFrame } from "./components/WindowChrome/CustomWindowFrame";
import { ToastLabShell } from "./components/ToastLab/ToastLabShell";
import "./ToastLabApp.css";

export function ToastLabApp() {
  return (
    <CustomWindowFrame title="Toast Lab" className="toast-lab-app">
      <ToastLabShell />
    </CustomWindowFrame>
  );
}
