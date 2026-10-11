import { CustomWindowFrame } from "./components/WindowChrome/CustomWindowFrame";
import { LyricsReviewQueue } from "./components/LyricsReviewQueue/LyricsReviewQueue";
import { ToastLabShell } from "./components/ToastLab/ToastLabShell";
import { WhatsNewModal } from "./components/WhatsNewModal/WhatsNewModal";
import "./ToastLabApp.css";

export function ToastLabApp() {
  return (
    <CustomWindowFrame title="Toast Lab" className="toast-lab-app">
      <ToastLabShell />
      <LyricsReviewQueue />
      <WhatsNewModal />
    </CustomWindowFrame>
  );
}
