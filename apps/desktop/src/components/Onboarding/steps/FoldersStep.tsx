import { useState } from "react";
import { useTranslation } from "react-i18next";
import { describeSourceError, sourceRole } from "../../../lib/sourceAccess";
import { addSource, pickMusicFolder } from "../../../lib/tauri";
import { useSourcesStore } from "../../../store/useSourcesStore";
import { Button } from "../../common/Button/Button";
import { IconOpenFolder, IconPlus } from "../../icons";

/**
 * "It's already organized": add the root folders the user's music lives in.
 * Each becomes a source, played where it is and left unorganized. Lists every
 * folder source, so going Back and returning keeps what was added.
 */
export function FoldersStep() {
  const { t } = useTranslation("common");
  const sources = useSourcesStore((s) => s.sources);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const folders = sources.filter((source) => sourceRole(source) === "user");

  const add = async () => {
    if (adding) return;
    setAdding(true);
    setError(null);
    try {
      const folder = await pickMusicFolder();
      if (!folder) return;
      useSourcesStore.getState().applySource(await addSource(folder));
    } catch (err) {
      setError(describeSourceError(err));
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="onboarding-folders">
      {folders.length > 0 ? (
        <ul
          className="onboarding-folders__list"
          aria-label={t("onboarding.folders.listAria")}
        >
          {folders.map((source) => (
            <li key={source.id} className="onboarding-folders__item">
              <span className="onboarding-folders__icon" aria-hidden="true">
                <IconOpenFolder width={20} height={20} />
              </span>
              <span className="onboarding-folders__text">
                <span className="onboarding-folders__name">{source.name}</span>
                <span
                  className="onboarding-folders__path"
                  title={source.rootPath ?? undefined}
                >
                  {source.rootPath}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <Button
        variant="outline"
        className="onboarding-folders__add"
        onClick={() => void add()}
        isLoading={adding}
      >
        <IconPlus aria-hidden />
        {t("onboarding.folders.add")}
      </Button>
      {error ? (
        <p className="onboarding__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
