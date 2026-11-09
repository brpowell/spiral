import { useId, useRef, useState } from "react";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { useCdStore } from "@/store/useCdStore";
import { useOnboardingStore } from "@/store/useOnboardingStore";
import { Button } from "@/components/common/Button/Button";
import { Checkbox } from "@/components/common/Checkbox/Checkbox";
import {
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalHeaderMain,
  ModalTitle,
} from "@/components/common/Modal/Modal";
import "./CdMusicBrainzFetchModal.css";
export function CdMusicBrainzFetchModal() {
  const promptDriveId = useCdStore((s) => s.metadataFetchPromptDriveId);
  const onboardingOpen = useOnboardingStore((s) => s.open);
  const confirmMetadataFetch = useCdStore((s) => s.confirmMetadataFetch);
  const cancelMetadataFetch = useCdStore((s) => s.cancelMetadataFetch);

  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [remember, setRemember] = useState(false);

  // A disc found during onboarding keeps its place in the queue until it ends.
  const open = promptDriveId != null && !onboardingOpen;
  useFocusTrap(panelRef, open);

  const handleConfirm = () => {
    if (promptDriveId == null) return;
    confirmMetadataFetch(promptDriveId, remember);
    setRemember(false);
  };

  const handleCancel = () => {
    if (promptDriveId == null) return;
    cancelMetadataFetch(promptDriveId, remember);
    setRemember(false);
  };

  return (
    <Modal
      open={open}
      onClose={handleCancel}
      size="xl"
      panelClassName="cd-musicbrainz-fetch-modal"
      panelRef={panelRef}
      labelledBy={titleId}
    >
      <ModalHeader>
        <ModalHeaderMain>
          <ModalTitle id={titleId}>Fetch CD metadata</ModalTitle>
        </ModalHeaderMain>
      </ModalHeader>

      <ModalBody>
        <p className="cd-musicbrainz-fetch-modal__message">
          Would you like to look up additional album and track information from
          MusicBrainz?
        </p>
        <Checkbox
          variant="muted"
          checked={remember}
          onChange={(e) => setRemember(e.target.checked)}
        >
          Don&apos;t ask again
        </Checkbox>
      </ModalBody>

      <ModalFooter onCancel={handleCancel} cancelLabel="Not now">
        <Button variant="primary" onClick={handleConfirm}>
          Fetch metadata
        </Button>
      </ModalFooter>
    </Modal>
  );
}
