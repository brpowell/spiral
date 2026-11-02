import { Trans, useTranslation } from "react-i18next";
import { shortenHomePath, useHomeDir } from "../../../lib/homePath";
import { DEFAULT_SOURCE_ID } from "../../../lib/sourceAccess";
import { useLibrarySettingsStore } from "../../../store/useLibrarySettingsStore";
import {
  useOnboardingStore,
  type MusicChoice,
} from "../../../store/useOnboardingStore";
import { useSourcesStore } from "../../../store/useSourcesStore";
import { RadioGroup, RadioGroupItem } from "../../common/RadioGroup/RadioGroup";
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
    <RadioGroup
      variant="card"
      orientation="vertical"
      className="onboarding-cards"
      value={musicChoice}
      onChange={setMusicChoice}
      aria-label={t("onboarding.library.title")}
    >
      {CHOICES.map(({ id, Icon }) => (
        <RadioGroupItem
          key={id}
          value={id}
          icon={<Icon />}
          description={
            id === "new" ? (
              <Trans
                i18nKey="onboarding.library.newMessage"
                ns="common"
                values={{ path: newPath }}
                components={{ code: <code /> }}
              />
            ) : (
              t("onboarding.library.existingDetail")
            )
          }
        >
          {t(`onboarding.library.choice.${id}`)}
        </RadioGroupItem>
      ))}
    </RadioGroup>
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
