import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { assetUrlFromPath } from "../../../lib/assetUrl";
import type { ImageCrop } from "../../../lib/imageCrop";
import { Button } from "../Button/Button";
import { ImageCropper } from "../ImageCropper/ImageCropper";
import {
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalHeaderMain,
  ModalTitle,
} from "../Modal/Modal";
import "./ImageCropModal.css";

export type ImageCropModalProps = {
  open: boolean;
  /** Absolute filesystem path of the image to crop. */
  filePath: string | null;
  /** Locks the cropper and shows progress while the crop is being applied. */
  busy?: boolean;
  aspect?: number;
  /** Circular mask, for art that is rendered round. */
  round?: boolean;
  initialCrop?: ImageCrop | null;
  title?: string;
  onApply: (crop: ImageCrop) => void;
  onClose: () => void;
};

export function ImageCropModal({
  open,
  filePath,
  busy = false,
  aspect = 1,
  round = false,
  initialCrop = null,
  title,
  onApply,
  onClose,
}: ImageCropModalProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const [crop, setCrop] = useState<ImageCrop | null>(initialCrop);

  // Sync convertFileSrc — avoid waiting on async mtime IPC before first paint.
  // Staged files reuse one path, so bust the webview's cache on every open.
  const src = useMemo(() => {
    if (!open || !filePath) return null;
    const base = assetUrlFromPath(filePath);
    return `${base}${base.includes("?") ? "&" : "?"}v=${Date.now()}`;
  }, [open, filePath]);

  // Reset during render, not in an effect: an effect can run after a fast image
  // load has already set the default crop and wipe it, leaving Apply disabled.
  const [syncedSrc, setSyncedSrc] = useState(src);
  if (src !== syncedSrc) {
    setSyncedSrc(src);
    setCrop(initialCrop);
  }

  const canApply = open && src != null && crop != null && !busy;
  const handleClose = () => {
    if (!busy) onClose();
  };

  return (
    <Modal open={open} onClose={handleClose} size="sm" labelledBy={titleId}>
      <ModalHeader>
        <ModalHeaderMain>
          <ModalTitle id={titleId}>
            {title ?? t("common:imageCrop.title")}
          </ModalTitle>
        </ModalHeaderMain>
      </ModalHeader>
      <ModalBody className="image-crop-modal__body">
        {src ? (
          <ImageCropper
            src={src}
            aspect={aspect}
            round={round}
            value={crop}
            onChange={setCrop}
            disabled={busy}
            className="image-crop-modal__cropper"
          />
        ) : null}
      </ModalBody>
      <ModalFooter onCancel={handleClose}>
        <Button
          disabled={!canApply}
          isLoading={busy}
          onClick={() => {
            if (crop) onApply(crop);
          }}
        >
          {t("common:imageCrop.apply")}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
