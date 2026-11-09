import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";
import {
  SPIRAL_DISCOVERY_URL,
  SPIRAL_DISCUSSIONS_URL,
  SPIRAL_GITHUB_URL,
} from "@/components/About/aboutContent";
import { Button } from "@/components/common/Button/Button";
import { CoffeeButton } from "@/components/common/CoffeeButton/CoffeeButton";
import {
  IconCompass,
  IconMessagesSquare,
  IconStarOutline,
} from "@/components/icons";

/** The note on the left: gentle, and last so it never blocks setup. */
export function SupportMessage() {
  const { t } = useTranslation("common");
  return (
    <div className="onboarding-support__message">
      {(["intro", "artists", "closing", "signature"] as const).map((key) => (
        <p className="onboarding-support__text" key={key}>
          {t(`onboarding.support.${key}`)}
        </p>
      ))}
    </div>
  );
}

/** The links on the right. */
export function SupportActions() {
  const { t } = useTranslation("common");
  return (
    <div className="onboarding-support">
      <CoffeeButton size="lg" />
      <Button size="lg" onClick={() => void openUrl(SPIRAL_DISCUSSIONS_URL)}>
        <IconMessagesSquare />
        {t("onboarding.support.discussion")}
      </Button>
      <Button size="lg" onClick={() => void openUrl(SPIRAL_GITHUB_URL)}>
        <IconStarOutline />
        {t("onboarding.support.star")}
      </Button>
      <Button size="lg" onClick={() => void openUrl(SPIRAL_DISCOVERY_URL)}>
        <IconCompass />
        {t("onboarding.support.discovery")}
      </Button>
    </div>
  );
}
