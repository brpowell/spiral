import { Trans, useTranslation } from "react-i18next";
import { shortenHomePath, useHomeDir } from "@/lib/homePath";
import { useLibrarySettingsStore } from "@/store/useLibrarySettingsStore";
import {
  useOnboardingStore,
  type MusicChoice,
} from "@/store/useOnboardingStore";
import {
  RadioGroup,
  RadioGroupItem,
} from "@/components/common/RadioGroup/RadioGroup";
import { IconFolderCog, IconFolderPen } from "@/components/icons";

const CHOICES: { id: MusicChoice; Icon: typeof IconFolderCog }[] = [
  { id: "new", Icon: IconFolderCog },
  { id: "existing", Icon: IconFolderPen },
];

/**
 * "How do you want your music organized?": let Spiral manage a Tracks folder
 * (the card says where), or use folders the user picks. The second answer
 * adds a step for picking those folders; a new library's empty Tracks
 * folder gives way to them.
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
 * Where a new collection goes: the Spiral folder's Tracks, which Spiral
 * creates and manages when this answer is applied. Shown with the home
 * folder as `~` so it reads short.
 */
function useNewCollectionPath(): string {
  const mediaFolder = useLibrarySettingsStore((s) => s.settings?.mediaFolder);
  return shortenHomePath(mediaFolder ?? "", useHomeDir());
}
