import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";
import { TextLink } from "../common/TextLink/TextLink";
import { CREDIT_ENTRIES } from "./aboutContent";

export function CreditsPanel() {
  const { t } = useTranslation("about");

  return (
    <div className="about-panel about-panel--scroll">
      <header className="about-credits__title-credit">
        <p className="about-credits__role">{t("credits.bryan.role")}</p>
        <p className="about-credits__name">{t("credits.bryan.name")}</p>
      </header>

      <p className="about-panel__intro">{t("credits.intro")}</p>

      <ul className="about-credits">
        {CREDIT_ENTRIES.map((entry) => (
          <li key={entry.id} className="about-credits__item">
            <p className="about-credits__role">{t(entry.roleKey)}</p>
            <TextLink
              href={entry.url}
              target="_blank"
              onClick={(e) => {
                e.preventDefault();
                void openUrl(entry.url);
              }}
            >
              {t(entry.nameKey)}
            </TextLink>
          </li>
        ))}
      </ul>
    </div>
  );
}
