import { useTranslation } from "react-i18next";
import {
  Modal,
  ModalBody,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from "../common/Modal/Modal";
import { Badge } from "../common/Badge/Badge";
import { ChoiceList, ChoiceOption } from "../common/ChoiceOption/ChoiceOption";
import {
  discMetadataLabel,
  discMetadataReleaseDetails,
} from "../../lib/cdMetadata";
import { useCdStore } from "../../store/useCdStore";
import "./CdMetadataPicker.css";

export function CdMetadataPicker() {
  const { t } = useTranslation("library");
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
      size="md"
      labelledBy="cd-metadata-title"
    >
      <ModalHeader fade>
        <ModalTitle id="cd-metadata-title">{t("cd.picker.title")}</ModalTitle>
      </ModalHeader>
      <ModalBody>
        <ModalDescription>{t("cd.picker.description")}</ModalDescription>
        <ChoiceList className="cd-metadata-picker__list">
          {candidates.map((candidate) => {
            const key = candidate.releaseMbid ?? discMetadataLabel(candidate);
            const releaseDetails = discMetadataReleaseDetails(candidate);
            const selected =
              current?.releaseMbid != null &&
              candidate.releaseMbid === current.releaseMbid;
            return (
              <li key={key}>
                <ChoiceOption
                  title={discMetadataLabel(candidate)}
                  details={releaseDetails}
                  selected={selected}
                  meta={
                    <>
                      {selected ? (
                        <Badge variant="accent">{t("cd.picker.current")}</Badge>
                      ) : null}
                      {t("counts.tracks", { count: candidate.tracks.length })}
                    </>
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
