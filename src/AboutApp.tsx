import { AboutShell } from "./components/About/AboutShell";
import { CustomWindowFrame } from "./components/WindowChrome/CustomWindowFrame";
import { useAboutWindowClose } from "./hooks/useAboutWindowClose";
import { t } from "./lib/i18n";
import "./AboutApp.css";

export function AboutApp() {
  useAboutWindowClose();

  return (
    <CustomWindowFrame title={t("about:windowTitle")} className="about-app">
      <main className="about-app__main">
        <AboutShell />
      </main>
    </CustomWindowFrame>
  );
}
