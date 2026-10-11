import { useId, useRef, useState } from "react";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useCdStore } from "../../store/useCdStore";
import { Button } from "../common/Button/Button";
import { Checkbox } from "../common/Checkbox/Checkbox";
import {
  Modal,
  ModalBody,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalHeaderMain,
  ModalTitle,
} from "../common/Modal/Modal";
export function CdMusicBrainzFetchModal() {
  const promptDriveId = useCdStore((s) => s.metadataFetchPromptDriveId);
  const confirmMetadataFetch = useCdStore((s) => s.confirmMetadataFetch);
  const cancelMetadataFetch = useCdStore((s) => s.cancelMetadataFetch);

  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [remember, setRemember] = useState(false);

  const open = promptDriveId != null;
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
      panelRef={panelRef}
      labelledBy={titleId}
    >
      <ModalHeader>
        <ModalHeaderMain>
          <ModalTitle id={titleId}>Fetch CD metadata</ModalTitle>
          <ModalDescription>
            Would you like to look up additional album and track information from MusicBrainz?
          </ModalDescription>
        </ModalHeaderMain>
      </ModalHeader>

      <ModalBody>
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
