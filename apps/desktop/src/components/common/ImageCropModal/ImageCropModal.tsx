import { useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { assetUrlFromPath } from "../../../lib/assetUrl";
import { imageOutputSizeOptions, type ImageCrop } from "../../../lib/imageCrop";
import { Button } from "../Button/Button";
import { useOutputSizes } from "../../../hooks/useOutputSizes";
import { formatBytes } from "../../../lib/formatBytes";
import { clearArtMeasureCache } from "../../../lib/tauri";
import { Select } from "../Select/Select";
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
  const selectedIndex = Math.max(
    0,
    sizeOptions.findIndex((o) => o.maxEdge === maxEdge),
  );
  const measured = useOutputSizes(
    filePath,
    crop,
    sizeOptions.map((option) => option.maxEdge),
    sizeOptions.length > 1,
    selectedIndex,
  );
  const selectedBytes = measured?.outputBytes[selectedIndex];
  // A preset stops being offered once the crop gets small enough.
  const effectiveMaxEdge = sizeOptions.some((o) => o.maxEdge === maxEdge)
    ? maxEdge
    : null;

  // The backend keeps the decoded source for measuring; free it on close.
  useEffect(() => {
    if (!open || !showSizeOptions) return;
    return () => {
      void clearArtMeasureCache().catch(() => {});
    };
  }, [open, showSizeOptions]);

  const canApply = open && src != null && crop != null && !busy;
  const handleClose = () => {
    if (!busy) onClose();
  };

  return (
    <Modal open={open} onClose={handleClose} size="lg" labelledBy={titleId}>
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
          >
            {sizeOptions.length > 1 ? (
              <label className="image-crop-modal__size">
                <span className="image-crop-modal__size-label">
                  {t("common:imageCrop.size")}
                </span>
                <Select
                  aria-label={t("common:imageCrop.size")}
                  value={String(effectiveMaxEdge ?? "full")}
                  disabled={busy}
                  onChange={(value) =>
                    setMaxEdge(value === "full" ? null : Number(value))
                  }
                  options={sizeOptions.map((option, index) => ({
                    value: String(option.maxEdge ?? "full"),
                    label: t(
                      option.maxEdge == null
                        ? "common:imageCrop.sizeFull"
                        : "common:imageCrop.sizeOption",
                      { width: option.width, height: option.height },
                    ),
                    description:
                      measured?.outputBytes[index] != null
                        ? formatBytes(measured.outputBytes[index])
                        : t("common:imageCrop.sizeMeasuring"),
                  }))}
                />
                <span
                  className="image-crop-modal__size-estimate"
                  aria-live="polite"
                >
                  {selectedBytes != null && measured?.sourceBytes != null
                    ? t("common:imageCrop.sizeEstimate", {
                        output: formatBytes(selectedBytes),
                        source: formatBytes(measured.sourceBytes),
                      })
                    : t("common:imageCrop.sizeMeasuring")}
                </span>
              </label>
            ) : null}
          </ImageCropper>
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
