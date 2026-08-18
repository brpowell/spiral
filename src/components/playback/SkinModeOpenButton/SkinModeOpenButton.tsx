import { Button } from "../../common/Button/Button";
import { IconSkinMode } from "../../icons";
import { t } from "../../../lib/i18n";
import { openSkinMode } from "../../../lib/skinModeWindow";
import { isTauri } from "../../../lib/windowRole";

export function SkinModeOpenButton() {
  if (!isTauri()) return null;

  return (
    <Button
      variant="ghost"
      size="sm"
      iconOnly
      className="playback-btn playback-btn--pop-out"
      onClick={() => void openSkinMode()}
      aria-label={t("playback:skinMode.openAria")}
      title={t("playback:skinMode.openTitle")}
    >
      <IconSkinMode />
    </Button>
  );
}
