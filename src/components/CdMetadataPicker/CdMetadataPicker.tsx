import {
  Modal,
  ModalBody,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from "../common/Modal/Modal";
import { ChoiceList, ChoiceOption } from "../common/ChoiceOption/ChoiceOption";
import {
  discMetadataLabel,
  discMetadataReleaseDetails,
} from "../../lib/cdMetadata";
import { useCdStore } from "../../store/useCdStore";
import "./CdMetadataPicker.css";

export function CdMetadataPicker() {
  const metadataPickDriveId = useCdStore((s) => s.metadataPickDriveId);
  const metadataCandidatesByDriveId = useCdStore(
    (s) => s.metadataCandidatesByDriveId,
  );
  const selectDiscMetadata = useCdStore((s) => s.selectDiscMetadata);
  const dismissDiscMetadataPick = useCdStore((s) => s.dismissDiscMetadataPick);

  const driveId = metadataPickDriveId;
  const candidates =
    driveId != null ? (metadataCandidatesByDriveId[driveId] ?? []) : [];
  const open = driveId != null && candidates.length > 1;

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
      <ModalHeader>
        <ModalTitle id="cd-metadata-title">Match this disc</ModalTitle>
      </ModalHeader>
      <ModalBody>
        <ModalDescription>
          Multiple albums matched this disc. Choose the correct release to use
          for track titles and album details.
        </ModalDescription>
        <ChoiceList className="cd-metadata-picker__list">
          {candidates.map((candidate) => {
            const key = candidate.releaseMbid ?? discMetadataLabel(candidate);
            const releaseDetails = discMetadataReleaseDetails(candidate);
            return (
              <li key={key}>
                <ChoiceOption
                  title={discMetadataLabel(candidate)}
                  details={releaseDetails}
                  meta={
                    <>
                      {candidate.tracks.length}{" "}
                      {candidate.tracks.length === 1 ? "track" : "tracks"}
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
      <ModalFooter onCancel={handleClose} cancelLabel="Skip for now">
        {null}
      </ModalFooter>
    </Modal>
  );
}
