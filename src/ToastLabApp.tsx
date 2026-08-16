import { CustomWindowFrame } from "./components/WindowChrome/CustomWindowFrame";
import { LyricsReviewQueue } from "./components/LyricsReviewQueue/LyricsReviewQueue";
import { ToastLabShell } from "./components/ToastLab/ToastLabShell";
import { t } from "./lib/i18n";
import "./ToastLabApp.css";

export function ToastLabApp() {
  return (
    <CustomWindowFrame
      title={t("menus:developer.toastLab")}
      className="toast-lab-app"
    >
      <ToastLabShell />
      <LyricsReviewQueue />
    </CustomWindowFrame>
  );
}
