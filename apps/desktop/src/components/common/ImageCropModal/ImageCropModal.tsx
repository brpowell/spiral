import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { assetUrlFromPath } from "../../../lib/assetUrl";
import { imageOutputSizeOptions, type ImageCrop } from "../../../lib/imageCrop";
import { Button } from "../Button/Button";
import { NativeSelect } from "../NativeSelect/NativeSelect";
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
  /** Offers an output size choice. The caller must honor the `maxEdge` it gets back. */
  showSizeOptions?: boolean;
  initialMaxEdge?: number | null;
  title?: string;
  onApply: (crop: ImageCrop, maxEdge: number | null) => void;
  onClose: () => void;
};

export function ImageCropModal({
  open,
  filePath,
  busy = false,
  aspect = 1,
  round = false,
  initialCrop = null,
  showSizeOptions = false,
  initialMaxEdge = null,
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
  const [natural, setNatural] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [maxEdge, setMaxEdge] = useState<number | null>(initialMaxEdge);
  if (src !== syncedSrc) {
    setSyncedSrc(src);
    setCrop(initialCrop);
    setNatural(null);
    setMaxEdge(initialMaxEdge);
  }

  const sizeOptions =
    showSizeOptions && natural && crop
      ? imageOutputSizeOptions(natural.width, natural.height, crop)
      : [];
  // A preset stops being offered once the crop gets small enough.
  const effectiveMaxEdge = sizeOptions.some((o) => o.maxEdge === maxEdge)
    ? maxEdge
    : null;

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
            onNaturalSize={setNatural}
            className="image-crop-modal__cropper"
          />
        ) : null}
        {sizeOptions.length > 1 ? (
          <label className="image-crop-modal__size">
            <span className="image-crop-modal__size-label">
              {t("common:imageCrop.size")}
            </span>
            <NativeSelect
              aria-label={t("common:imageCrop.size")}
              value={String(effectiveMaxEdge ?? "full")}
              disabled={busy}
              onChange={(value) =>
                setMaxEdge(value === "full" ? null : Number(value))
              }
              options={sizeOptions.map((option) => ({
                value: String(option.maxEdge ?? "full"),
                label: t(
                  option.maxEdge == null
                    ? "common:imageCrop.sizeFull"
                    : "common:imageCrop.sizeOption",
                  { width: option.width, height: option.height },
                ),
              }))}
            />
          </label>
        ) : null}
      </ModalBody>
      <ModalFooter onCancel={handleClose}>
        <Button
          disabled={!canApply}
          isLoading={busy}
          onClick={() => {
            if (crop) onApply(crop, effectiveMaxEdge);
          }}
        >
          {t("common:imageCrop.apply")}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
