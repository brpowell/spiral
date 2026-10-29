import {
  useCallback,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { useTranslation } from "react-i18next";
import {
  IMAGE_CROP_MAX_ZOOM,
  IMAGE_CROP_MIN_ZOOM,
  coverCrop,
  cropToFrameStyle,
  panCrop,
  zoomCrop,
  zoomFromCrop,
  type ImageCrop,
} from "../../../lib/imageCrop";
import { Slider } from "../Slider/Slider";
import "./ImageCropper.css";

export type ImageCropperProps = {
  src: string;
  aspect?: number;
  /** Masks the frame to match how the result is rendered. */
  round?: boolean;
  value: ImageCrop | null;
  onChange: (crop: ImageCrop) => void;
  className?: string;
  disabled?: boolean;
};

export function ImageCropper({
  src,
  aspect = 1,
  round = false,
  value,
  onChange,
  className = "",
  disabled = false,
}: ImageCropperProps) {
  const { t } = useTranslation();
  const frameRef = useRef<HTMLDivElement>(null);
  // Tagged with the src it was measured for, so a stale size from a previous
  // image is ignored and a fast (cached) load can't be wiped by a reset effect.
  const [measured, setMeasured] = useState<{
    src: string;
    width: number;
    height: number;
  } | null>(null);
  const naturalSize = measured?.src === src ? measured : null;
  const dragRef = useRef<{
    pointerId: number;
    lastX: number;
    lastY: number;
  } | null>(null);

  const crop: ImageCrop =
    value ??
    (naturalSize
      ? coverCrop(naturalSize.width, naturalSize.height, aspect)
      : coverCrop(1, 1, aspect));

  const zoom = naturalSize
    ? zoomFromCrop(crop, naturalSize.width, naturalSize.height, aspect)
    : IMAGE_CROP_MIN_ZOOM;

  const frameStyle = cropToFrameStyle(crop);

  const emitDefaultIfNeeded = useCallback(
    (width: number, height: number) => {
      if (value == null) {
        onChange(coverCrop(width, height, aspect));
      }
    },
    [aspect, onChange, value],
  );

  const handleImageLoad = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      const img = e.currentTarget;
      const width = img.naturalWidth;
      const height = img.naturalHeight;
      if (width <= 0 || height <= 0) return;
      setMeasured({ src, width, height });
      emitDefaultIfNeeded(width, height);
    },
    [emitDefaultIfNeeded, src],
  );

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (disabled || !naturalSize) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      dragRef.current = {
        pointerId: e.pointerId,
        lastX: e.clientX,
        lastY: e.clientY,
      };
    },
    [disabled, naturalSize],
  );

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      const frame = frameRef.current;
      if (!frame) return;
      const rect = frame.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const dx = (e.clientX - drag.lastX) / rect.width;
      const dy = (e.clientY - drag.lastY) / rect.height;
      drag.lastX = e.clientX;
      drag.lastY = e.clientY;
      onChange(panCrop(crop, dx, dy));
    },
    [crop, onChange],
  );

  const endDrag = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }, []);

  const handleWheel = useCallback(
    (e: ReactWheelEvent<HTMLDivElement>) => {
      if (disabled || !naturalSize) return;
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.12 : 0.12;
      const next = Math.min(
        IMAGE_CROP_MAX_ZOOM,
        Math.max(IMAGE_CROP_MIN_ZOOM, zoom + delta),
      );
      onChange(
        zoomCrop(crop, naturalSize.width, naturalSize.height, next, aspect),
      );
    },
    [aspect, crop, disabled, naturalSize, onChange, zoom],
  );

  const handleZoomChange = useCallback(
    (nextZoom: number) => {
      if (!naturalSize) return;
      onChange(
        zoomCrop(crop, naturalSize.width, naturalSize.height, nextZoom, aspect),
      );
    },
    [aspect, crop, naturalSize, onChange],
  );

  const rootClass = ["image-cropper", className].filter(Boolean).join(" ");
  const imgStyle: CSSProperties = {
    width: frameStyle.width,
    height: frameStyle.height,
    left: frameStyle.left,
    top: frameStyle.top,
  };

  return (
    <div className={rootClass}>
      <div
        ref={frameRef}
        className={
          round
            ? "image-cropper__frame image-cropper__frame--round"
            : "image-cropper__frame"
        }
        style={{ aspectRatio: String(aspect) }}
        role="img"
        aria-label={t("common:imageCrop.frameAria")}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onWheel={handleWheel}
      >
        <img
          src={src}
          alt=""
          draggable={false}
          className={
            naturalSize
              ? "image-cropper__img image-cropper__img--ready"
              : "image-cropper__img"
          }
          style={imgStyle}
          onLoad={handleImageLoad}
        />
      </div>
      <div className="image-cropper__controls">
        <label className="image-cropper__zoom">
          <span className="image-cropper__zoom-label">
            {t("common:imageCrop.zoom")}
          </span>
          <Slider
            min={IMAGE_CROP_MIN_ZOOM}
            max={IMAGE_CROP_MAX_ZOOM}
            step={0.01}
            value={zoom}
            disabled={disabled || !naturalSize}
            aria-label={t("common:imageCrop.zoom")}
            onChange={(e) => handleZoomChange(Number(e.target.value))}
          />
        </label>
      </div>
    </div>
  );
}
