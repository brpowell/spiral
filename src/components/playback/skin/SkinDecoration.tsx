import { useEffect, useRef, useState } from "react";
import { skinAssetUrl, skinGifAssetUrl } from "../../../lib/skinAssets";
import { runSkinAction } from "../../../lib/skinActions";
import { loadSkinGif, playSkinGifOnCanvas } from "../../../lib/skinGifPlayback";
import { skinDragRegionDeepProps } from "../../../lib/skinDragRegion";
import type {
  DecorationNode,
  GifPresentation,
  LoadedSkinPack,
} from "../../../types/skin";
import "./SkinDecoration.css";

function SkinGifDecoration({
  node,
  pack,
  presentation,
}: {
  node: DecorationNode;
  pack: LoadedSkinPack;
  presentation: GifPresentation;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [playKey] = useState(() => Date.now());
  const [frameReady, setFrameReady] = useState(false);
  const baseSrc = skinGifAssetUrl(pack.packDir, presentation.assetBase);
  const { durationMs, playbackRate, completeAction, completePayload } =
    presentation;

  useEffect(() => {
    setFrameReady(false);
    const canvas = canvasRef.current;
    if (!canvas) return;

    let playbackStop: (() => void) | undefined;
    let completionTimer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    const fireCompleteAction = () => {
      if (!completeAction) return;
      runSkinAction(completeAction, completePayload);
    };

    loadSkinGif(baseSrc)
      .then((decoded) => {
        if (cancelled) return;

        const handle = playSkinGifOnCanvas(canvas, decoded, {
          targetDurationMs: durationMs,
          playbackRate,
          loopForever: !completeAction,
          onFirstFrameDrawn: () => setFrameReady(true),
          ...(completeAction
            ? {
                onLoopComplete: (loopIndex) => {
                  if (loopIndex === 0) fireCompleteAction();
                },
              }
            : {}),
        });
        playbackStop = handle.stop;
      })
      .catch((err) => {
        console.warn("SkinGifDecoration: canvas playback failed, using <img>", err);
        if (cancelled) return;

        const img = document.createElement("img");
        img.src = `${baseSrc}${baseSrc.includes("?") ? "&" : "?"}_=${playKey}`;
        img.onload = () => {
          const ctx = canvas.getContext("2d");
          if (!ctx) return;
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          ctx.drawImage(img, 0, 0);
          setFrameReady(true);
        };

        if (completeAction && durationMs) {
          completionTimer = setTimeout(fireCompleteAction, durationMs);
        }
      });

    return () => {
      cancelled = true;
      playbackStop?.();
      if (completionTimer) clearTimeout(completionTimer);
    };
  }, [
    baseSrc,
    playKey,
    durationMs,
    playbackRate,
    completeAction,
    completePayload,
  ]);

  return (
    <canvas
      ref={canvasRef}
      className={[
        "skin-decoration",
        "skin-decoration--gif",
        node.dragRegion && "skin-decoration--drag",
      ]
        .filter(Boolean)
        .join(" ")}
      data-node-id={node.id}
      {...(node.dragRegion ? skinDragRegionDeepProps() : {})}
      style={{ opacity: frameReady ? 1 : 0 }}
      aria-hidden
    />
  );
}

export function SkinDecoration({
  node,
  pack,
}: {
  node: DecorationNode;
  pack: LoadedSkinPack;
}) {
  const presentation = node.presentation;

  if (presentation.kind === "primitive") {
    const prefix = presentation.classPrefix ?? "skin-decoration";
    return (
      <div
        className={[
          "skin-decoration",
          prefix,
          node.dragRegion && "skin-decoration--drag",
        ]
          .filter(Boolean)
          .join(" ")}
        data-node-id={node.id}
        {...(node.dragRegion ? skinDragRegionDeepProps() : {})}
        aria-hidden
      />
    );
  }

  if (presentation.kind === "gif") {
    return (
      <SkinGifDecoration node={node} pack={pack} presentation={presentation} />
    );
  }

  if (presentation.kind !== "bitmap") return null;

  const src = skinAssetUrl(pack.packDir, presentation.assetBase);

  return (
    <div
      className={[
        "skin-decoration",
        "skin-decoration--bitmap",
        node.dragRegion && "skin-decoration--drag",
      ]
        .filter(Boolean)
        .join(" ")}
      data-node-id={node.id}
      {...(node.dragRegion ? skinDragRegionDeepProps() : {})}
      style={{ backgroundImage: `url("${src}")` }}
      aria-hidden
    />
  );
}
