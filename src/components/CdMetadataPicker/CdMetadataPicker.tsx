import {
  Modal,
  ModalBody,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from "../common/Modal/Modal";
import { discMetadataLabel, discMetadataReleaseDetails } from "../../lib/cdMetadata";
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
    <Modal open={open} onClose={handleClose} size="md" labelledBy="cd-metadata-title">
      <ModalHeader>
        <ModalTitle id="cd-metadata-title">Match this disc</ModalTitle>
      </ModalHeader>
      <ModalBody>
        <ModalDescription>
          Multiple albums matched this disc. Choose the correct release to use
          for track titles and album details.
        </ModalDescription>
        <ul className="cd-metadata-picker__list">
          {candidates.map((candidate) => {
            const key = candidate.releaseMbid ?? discMetadataLabel(candidate);
            const releaseDetails = discMetadataReleaseDetails(candidate);
            return (
              <li key={key}>
                <button
                  type="button"
                  className="cd-metadata-picker__option"
                  onClick={() => {
                    if (driveId == null) return;
                    selectDiscMetadata(driveId, candidate);
                  }}
                >
                  <span className="cd-metadata-picker__option-main">
                    <span className="cd-metadata-picker__option-title">
                      {discMetadataLabel(candidate)}
                    </span>
                    {releaseDetails ? (
                      <span className="cd-metadata-picker__option-details">
                        {releaseDetails}
                      </span>
                    ) : null}
                  </span>
                  <span className="cd-metadata-picker__option-meta">
                    {candidate.tracks.length}{" "}
                    {candidate.tracks.length === 1 ? "track" : "tracks"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </ModalBody>
      <ModalFooter onCancel={handleClose} cancelLabel="Skip for now">
        {null}
      </ModalFooter>
    </Modal>
  );
}
