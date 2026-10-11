import { useEffect, useId, useMemo, useState } from "react";
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
  aspect?: number;
  initialCrop?: ImageCrop | null;
  title?: string;
  onApply: (crop: ImageCrop) => void;
  onClose: () => void;
};

export function ImageCropModal({
  open,
  filePath,
  aspect = 1,
  initialCrop = null,
  title,
  onApply,
  onClose,
}: ImageCropModalProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const [crop, setCrop] = useState<ImageCrop | null>(initialCrop);

  // Sync convertFileSrc — avoid waiting on async mtime IPC before first paint.
  const src = useMemo(
    () => (filePath ? assetUrlFromPath(filePath) : null),
    [filePath],
  );

  useEffect(() => {
    if (!open) return;
    setCrop(initialCrop);
  }, [open, filePath, initialCrop]);

  const canApply = open && src != null && crop != null;

  return (
    <Modal open={open} onClose={onClose} size="sm" labelledBy={titleId}>
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
            value={crop}
            onChange={setCrop}
            className="image-crop-modal__cropper"
          />
        ) : null}
      </ModalBody>
      <ModalFooter onCancel={onClose}>
        <Button
          disabled={!canApply}
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
