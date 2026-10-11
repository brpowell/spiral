import { useTranslation } from "react-i18next";
import { discMetadataToEntityHit } from "../../lib/cdMetadata";
import {
  musicBrainzHitFacts,
  musicBrainzHitTitle,
} from "../../lib/musicBrainzEntityDisplay";
import { useCdStore } from "../../store/useCdStore";
import { Badge } from "../common/Badge/Badge";
import { ChoiceList } from "../common/ChoiceOption/ChoiceOption";
import {
  Modal,
  ModalBody,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalHeaderMain,
  ModalTitle,
} from "../common/Modal/Modal";
import { MusicBrainzEntityCard } from "../MusicBrainzEditorTab/MusicBrainzEntityCard";

export function CdMetadataPicker() {
  const { t } = useTranslation(["library", "common"]);
  const metadataPickDriveId = useCdStore((s) => s.metadataPickDriveId);
  const metadataCandidatesByDriveId = useCdStore(
    (s) => s.metadataCandidatesByDriveId,
  );
  const metadataByDriveId = useCdStore((s) => s.metadataByDriveId);
  const selectDiscMetadata = useCdStore((s) => s.selectDiscMetadata);
  const dismissDiscMetadataPick = useCdStore((s) => s.dismissDiscMetadataPick);

  const driveId = metadataPickDriveId;
  const candidates =
    driveId != null ? (metadataCandidatesByDriveId[driveId] ?? []) : [];
  const current = driveId != null ? metadataByDriveId[driveId] : undefined;
  const open = driveId != null && candidates.length > 1;
  const hasCurrentRelease = current != null;

  const handleClose = () => {
    if (driveId == null) return;
    dismissDiscMetadataPick(driveId);
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      size="xl"
      labelledBy="cd-metadata-title"
    >
      <ModalHeader fade>
        <ModalHeaderMain>
          <ModalTitle id="cd-metadata-title">{t("cd.picker.title")}</ModalTitle>
          <ModalDescription>{t("cd.picker.description")}</ModalDescription>
        </ModalHeaderMain>
      </ModalHeader>
      <ModalBody>
        <ChoiceList>
          {candidates.map((candidate, index) => {
            const hit = discMetadataToEntityHit(
              candidate,
              t("common:unknownAlbum"),
            );
            const key = hit.mbid || `${hit.title}-${index}`;
            const selected =
              current?.releaseMbid != null &&
              candidate.releaseMbid === current.releaseMbid;
            return (
              <li key={key}>
                <MusicBrainzEntityCard
                  title={musicBrainzHitTitle(hit)}
                  subtitle={hit.artist?.trim() || undefined}
                  facts={musicBrainzHitFacts(hit, { omit: ["artist"] })}
                  selected={selected}
                  meta={
                    selected ? (
                      <Badge variant="accent">{t("cd.picker.current")}</Badge>
                    ) : undefined
                  }
                  onClick={() => {
                    if (driveId == null) return;
                    selectDiscMetadata(driveId, candidate);
                  }}
                />
              </li>
            );
          })}
        </ChoiceList>
      </ModalBody>
      <ModalFooter
        fade
        onCancel={handleClose}
        cancelLabel={
          hasCurrentRelease ? t("cd.picker.keepCurrent") : t("cd.picker.skip")
        }
      >
        {null}
      </ModalFooter>
    </Modal>
  );
}
