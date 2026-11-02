import { Trans, useTranslation } from "react-i18next";
import { shortenHomePath, useHomeDir } from "../../../lib/homePath";
import { DEFAULT_SOURCE_ID } from "../../../lib/sourceAccess";
import { useLibrarySettingsStore } from "../../../store/useLibrarySettingsStore";
import {
  useOnboardingStore,
  type MusicChoice,
} from "../../../store/useOnboardingStore";
import { useSourcesStore } from "../../../store/useSourcesStore";
import { IconFolderCog, IconFolderPen } from "../../icons";

const CHOICES: { id: MusicChoice; Icon: typeof IconFolderCog }[] = [
  { id: "new", Icon: IconFolderCog },
  { id: "existing", Icon: IconFolderPen },
];

/**
 * "Where do you keep your music?": starting a new collection in the Spiral
 * folder (the card says where), or pointing Spiral at folders that are
 * already organized. The second answer adds a step for picking those folders.
 */
export function LibraryStep() {
  const { t } = useTranslation("common");
  const musicChoice = useOnboardingStore((s) => s.musicChoice);
  const setMusicChoice = useOnboardingStore((s) => s.setMusicChoice);
  const newPath = useNewCollectionPath();

  return (
    <div
      className="onboarding-cards"
      role="radiogroup"
      aria-label={t("onboarding.library.title")}
    >
      {CHOICES.map(({ id, Icon }) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={musicChoice === id}
          className="onboarding-card"
          onClick={() => setMusicChoice(id)}
        >
          <span className="onboarding-card__icon" aria-hidden="true">
            <Icon width={24} height={24} />
          </span>
          <span className="onboarding-card__text">
            <span className="onboarding-card__label">
              {t(`onboarding.library.choice.${id}`)}
            </span>
            <span className="onboarding-card__detail">
              {id === "new" ? (
                <Trans
                  i18nKey="onboarding.library.newMessage"
                  ns="common"
                  values={{ path: newPath }}
                  components={{ code: <code /> }}
                />
              ) : (
                t("onboarding.library.existingDetail")
              )}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

/**
 * Where a new collection goes: the default source, the Spiral folder's Tracks.
 * Shown with the home folder as `~` so it reads short.
 */
function useNewCollectionPath(): string {
  const rootPath = useSourcesStore(
    (s) => s.sourcesById.get(DEFAULT_SOURCE_ID)?.rootPath,
  );
  const libraryRoot = useLibrarySettingsStore((s) => s.settings?.libraryRoot);
  const home = useHomeDir();
  const path =
    rootPath ??
    (libraryRoot ? `${libraryRoot.replace(/[\\/]+$/, "")}/Tracks` : "");
  return shortenHomePath(path, home);
}
