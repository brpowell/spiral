import { EqualizerShell } from "./components/Equalizer/EqualizerShell";
import { CustomWindowFrame } from "./components/WindowChrome/CustomWindowFrame";
import { useEqualizerWindowClose } from "./hooks/useEqualizerWindowClose";
import { t } from "./lib/i18n";
import "./EqualizerApp.css";

export function EqualizerApp() {
  useEqualizerWindowClose();

  return (
    <CustomWindowFrame
      title={t("menus:view.equalizer")}
      className="equalizer-app"
      showMaximize={false}
    >
      <EqualizerShell />
    </CustomWindowFrame>
  );
}
