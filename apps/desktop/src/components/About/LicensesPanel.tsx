import { useTranslation } from "react-i18next";
import fdkNotice from "../../assets/licenses/FDK-AAC-NOTICE.txt?raw";
import lgplText from "../../assets/licenses/LGPL-3.0.txt?raw";
import mplText from "../../assets/licenses/MPL-2.0.txt?raw";
import { ThirdPartyLicenses } from "./ThirdPartyLicenses";

interface SpecialNotice {
  id: "lame" | "fdk" | "symphonia";
  titleKey:
    | "licenses.special.lame.title"
    | "licenses.special.fdk.title"
    | "licenses.special.symphonia.title";
  body: string;
}

const SPECIAL_NOTICES: SpecialNotice[] = [
  {
    id: "lame",
    titleKey: "licenses.special.lame.title",
    body: lgplText,
  },
  {
    id: "fdk",
    titleKey: "licenses.special.fdk.title",
    body: fdkNotice,
  },
  {
    id: "symphonia",
    titleKey: "licenses.special.symphonia.title",
    body: mplText,
  },
];

export function LicensesPanel() {
  const { t } = useTranslation("about");

  return (
    <div className="about-panel about-panel--scroll">
      <article className="about-licenses-doc">
        {SPECIAL_NOTICES.map((notice, index) => (
          <section
            key={notice.id}
            className={
              index === 0
                ? "about-licenses-doc__section"
                : "about-licenses-doc__section about-licenses-doc__section--ruled"
            }
            aria-labelledby={`about-license-${notice.id}`}
          >
            <h3
              id={`about-license-${notice.id}`}
              className="about-licenses-doc__title"
            >
              {t(notice.titleKey)}
            </h3>
            <pre className="about-licenses-doc__body">{notice.body}</pre>
          </section>
        ))}
      </article>
      <div className="about-licenses-doc__section--ruled">
        <ThirdPartyLicenses />
      </div>
    </div>
  );
}
