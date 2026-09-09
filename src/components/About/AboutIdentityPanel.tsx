import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getAppVersion } from "../../lib/tauri";
import { TextLink } from "../common/TextLink/TextLink";
import { SPIRAL_WEBSITE_URL } from "./aboutContent";

export function AboutIdentityPanel() {
  const { t } = useTranslation("about");
  const [version, setVersion] = useState<string | null>(null);
  const year = new Date().getFullYear();

  useEffect(() => {
    let cancelled = false;
    void getAppVersion()
      .then((v) => {
        if (!cancelled) setVersion(v);
      })
      .catch(() => {
        if (!cancelled) setVersion(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <aside className="about-gutter" aria-label={t("about.name")}>
      <img
        className="about-gutter__icon"
        src="/app-icon.png"
        alt=""
        width={72}
        height={72}
        draggable={false}
      />
      <h2 className="about-gutter__name">{t("about.name")}</h2>
      <p className="about-gutter__version">
        {version != null
          ? t("about.version", { version })
          : t("about.versionLoading")}
      </p>
      <p className="about-gutter__copyright">
        {t("about.copyright", { year })}
      </p>
      <TextLink
        className="about-gutter__website"
        href={SPIRAL_WEBSITE_URL}
        target="_blank"
        aria-label={t("about.websiteAria")}
        onClick={(e) => {
          e.preventDefault();
          void openUrl(SPIRAL_WEBSITE_URL);
        }}
      >
        {t("about.website")}
      </TextLink>
    </aside>
  );
}
