import { useEffect, useRef, useState } from "react";
import { isSkinGifAsset } from "../../../lib/skinAssets";
import {
  drawSkinGifLastFrame,
  loadSkinGif,
  playSkinGifOnCanvas,
} from "../../../lib/skinGifPlayback";
import type { SkinAssetFile } from "../../../types/skin";
import "./SkinInteractiveAssetCanvas.css";

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
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(false);
    const canvas = canvasRef.current;
    if (!canvas) return;

    let playbackStop: (() => void) | undefined;
    let cancelled = false;

    const finishReady = () => {
      if (!cancelled) setReady(true);
    };

    if (!isSkinGifAsset(assetFile)) {
      const img = new Image();
      img.onload = () => {
        if (cancelled) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        finishReady();
      };
      img.onerror = () => {
        if (!cancelled) finishReady();
      };
      img.src = assetUrl;
      return () => {
        cancelled = true;
      };
    }

    loadSkinGif(assetUrl)
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
  }, [assetFile, assetUrl, animate, playKey]);

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
