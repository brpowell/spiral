import { useState } from "react";
import { useTranslation } from "react-i18next";
import { describeSourceError, sourceRole } from "../../../lib/sourceAccess";
import { addSource, pickMusicFolder, removeSource } from "../../../lib/tauri";
import { useOnboardingStore } from "../../../store/useOnboardingStore";
import { usePlayerStore } from "../../../store/usePlayerStore";
import { useSourcesStore } from "../../../store/useSourcesStore";
import type { Source } from "../../../types/source";
import { Button } from "../../common/Button/Button";
import { IconClose, IconOpenFolder, IconPlus } from "../../icons";

/**
 * "It's already organized": add the root folders the user's music lives in.
 * Each becomes a source, played where it is and left unorganized. Lists every
 * folder source, so going Back and returning keeps what was added.
 *
 * Folders added here can be removed again. One that was already a source
 * (onboarding replayed) may carry playlists and history, so removing it is
 * left to Preferences, which confirms first.
 */
export function FoldersStep() {
  const { t } = useTranslation("common");
  const sources = useSourcesStore((s) => s.sources);
  const addedSourceIds = useOnboardingStore((s) => s.addedSourceIds);
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const folders = sources.filter((source) => sourceRole(source) === "user");

  const add = async () => {
    if (adding) return;
    setAdding(true);
    setError(null);
    try {
      const folder = await pickMusicFolder();
      if (!folder) return;
      const source = await addSource(folder);
      useSourcesStore.getState().applySource(source);
      useOnboardingStore.getState().noteSourceAdded(source.id);
    } catch (err) {
      setError(describeSourceError(err));
    } finally {
      setAdding(false);
    }
  };

  const remove = async (source: Source) => {
    if (removingId != null) return;
    setRemovingId(source.id);
    setError(null);
    try {
      // Its tracks leave the library; the files on disk stay.
      await removeSource(source.id);
      useOnboardingStore.getState().noteSourceRemoved(source.id);
      await useSourcesStore.getState().loadSources();
      await usePlayerStore.getState().loadLibrary({ preservePlayback: true });
    } catch (err) {
      setError(describeSourceError(err));
    } finally {
      setRemovingId(null);
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
              {addedSourceIds.includes(source.id) ? (
                <Button
                  variant="ghost"
                  iconOnly
                  className="onboarding-folders__remove"
                  aria-label={t("onboarding.folders.remove", {
                    name: source.name,
                  })}
                  title={t("onboarding.folders.remove", { name: source.name })}
                  onClick={() => void remove(source)}
                  disabled={removingId != null}
                  isLoading={removingId === source.id}
                >
                  <IconClose aria-hidden />
                </Button>
              ) : null}
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
