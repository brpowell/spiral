import { useId } from "react";
import { Trans, useTranslation } from "react-i18next";
import { DEFAULT_SOURCE_ID } from "../../../lib/sourceAccess";
import { useLibrarySettingsStore } from "../../../store/useLibrarySettingsStore";
import {
  useOnboardingStore,
  type MusicChoice,
} from "../../../store/useOnboardingStore";
import { useSourcesStore } from "../../../store/useSourcesStore";
import { Button } from "../../common/Button/Button";
import { Modal, ModalBody, ModalFooter } from "../../common/Modal/Modal";
import { IconFileMusic, IconOpenFolder } from "../../icons";

const CHOICES: { id: MusicChoice; Icon: typeof IconFileMusic }[] = [
  { id: "new", Icon: IconFileMusic },
  { id: "existing", Icon: IconOpenFolder },
];

/**
 * "Where does your music live?": starting a new collection in the Spiral
 * folder, or pointing Spiral at folders that are already organized. The
 * second answer adds a step for picking those folders.
 */
export function LibraryStep() {
  const { t } = useTranslation("common");
  const musicChoice = useOnboardingStore((s) => s.musicChoice);
  const setMusicChoice = useOnboardingStore((s) => s.setMusicChoice);

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
          <span className="onboarding-card__label">
            {t(`onboarding.library.choice.${id}`)}
          </span>
        </button>
      ))}
    </div>
  );
}

/** Where a new collection goes: the default source, the Spiral folder's Tracks. */
function useNewCollectionPath(): string {
  const rootPath = useSourcesStore(
    (s) => s.sourcesById.get(DEFAULT_SOURCE_ID)?.rootPath,
  );
  const libraryRoot = useLibrarySettingsStore((s) => s.settings?.libraryRoot);
  if (rootPath) return rootPath;
  return libraryRoot ? `${libraryRoot.replace(/[\\/]+$/, "")}/Tracks` : "";
}

/** Shown on Next after "I'm starting a new collection": where music will go. */
export function NewCollectionDialog({
  open,
  onClose,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation("common");
  const titleId = useId();
  const path = useNewCollectionPath();

  return (
    <Modal open={open} onClose={onClose} size="sm" labelledBy={titleId}>
      <ModalBody>
        <p id={titleId} className="onboarding-new__message">
          <Trans
            i18nKey="onboarding.library.newMessage"
            ns="common"
            values={{ path }}
            components={{ code: <code className="onboarding-new__path" /> }}
          />
        </p>
      </ModalBody>
      <ModalFooter>
        <Button variant="primary" onClick={onConfirm}>
          {t("onboarding.library.newConfirm")}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
