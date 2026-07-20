import { useLayoutEffect, useRef, useState } from "react";
import { isSkinGifAsset } from "../../../lib/skinAssets";
import {
  getSkinBitmapIfReady,
  isSkinBitmapReady,
  loadSkinBitmap,
} from "../../../lib/skinBitmapCache";
import {
  drawSkinGifLastFrame,
  loadSkinGif,
  playSkinGifOnCanvas,
} from "../../../lib/skinGifPlayback";
import type { SkinAssetFile } from "../../../types/skin";
import "./SkinInteractiveAssetCanvas.css";

function drawBitmap(
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0);
}

export function SkinInteractiveAssetCanvas({
  assetFile,
  assetUrl,
  width,
  height,
  animate,
  playKey,
}: {
  assetFile: SkinAssetFile;
  assetUrl: string;
  width: number;
  height: number;
  animate: boolean;
  playKey: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isGif = isSkinGifAsset(assetFile);
  const [ready, setReady] = useState(
    () => !isGif && isSkinBitmapReady(assetUrl),
  );

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let playbackStop: (() => void) | undefined;
    let cancelled = false;

    const finishReady = () => {
      if (!cancelled) setReady(true);
    };

    if (!isGif) {
      const cached = getSkinBitmapIfReady(assetUrl);
      if (cached) {
        drawBitmap(canvas, cached);
        finishReady();
        return () => {
          cancelled = true;
        };
      }

      setReady(false);
      void loadSkinBitmap(assetUrl)
        .then((image) => {
          if (cancelled) return;
          drawBitmap(canvas, image);
          finishReady();
        })
        .catch(() => {
          if (!cancelled) finishReady();
        });

      return () => {
        cancelled = true;
      };
    }

    setReady(false);
    void loadSkinGif(assetUrl)
      .then((decoded) => {
        if (cancelled) return;

        if (!animate) {
          drawSkinGifLastFrame(canvas, decoded);
          finishReady();
          return;
        }

        const handle = playSkinGifOnCanvas(canvas, decoded, {
          onFirstFrameDrawn: finishReady,
        });
        playbackStop = handle.stop;
      })
      .catch((err) => {
        console.warn("SkinInteractiveAssetCanvas: playback failed", err);
        finishReady();
      });

    return () => {
      cancelled = true;
      playbackStop?.();
    };
  }, [assetFile, assetUrl, animate, playKey, isGif]);

  return (
    <canvas
      ref={canvasRef}
      className="skin-interactive-asset-canvas"
      style={{
        width: `${width}px`,
        height: `${height}px`,
        opacity: ready ? 1 : 0,
      }}
      aria-hidden
    />
  );
}
