import { useEffect, useRef, useState } from "react";
import { skinAssetFileUrl } from "../../../lib/skinAssets";
import {
  isSkinBitmapReady,
  loadSkinBitmap,
} from "../../../lib/skinBitmapCache";
import { loadSkinGif, playSkinGifOnCanvas } from "../../../lib/skinGifPlayback";
import { scheduleSkinEffects } from "../../../lib/skinEffects";
import { useSkinBindState } from "../../../lib/skinBinds";
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
  const bindState = useSkinBindState();
  const bindStateRef = useRef(bindState);
  bindStateRef.current = bindState;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [playKey] = useState(() => Date.now());
  const [frameReady, setFrameReady] = useState(false);
  const baseSrc = skinAssetFileUrl(pack.packDir, presentation.asset);
  const { durationMs, playbackRate, onComplete } = presentation;

  useEffect(() => {
    setFrameReady(false);
    const canvas = canvasRef.current;
    if (!canvas) return;

    let playbackStop: (() => void) | undefined;
    let completionTimer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    const fireComplete = () => {
      if (!onComplete?.length) return;
      scheduleSkinEffects(onComplete, () => bindStateRef.current);
    };

    loadSkinGif(baseSrc)
      .then((decoded) => {
        if (cancelled) return;

        const handle = playSkinGifOnCanvas(canvas, decoded, {
          targetDurationMs: durationMs,
          playbackRate,
          loopForever: !onComplete?.length,
          onFirstFrameDrawn: () => setFrameReady(true),
          ...(onComplete?.length
            ? {
                onLoopComplete: (loopIndex) => {
                  if (loopIndex === 0) fireComplete();
                },
              }
            : {}),
        });
        playbackStop = handle.stop;
      })
      .catch((err) => {
        console.warn(
          "SkinGifDecoration: canvas playback failed, using <img>",
          err,
        );
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

        if (onComplete?.length && durationMs) {
          completionTimer = setTimeout(fireComplete, durationMs);
        }
      });

    return () => {
      cancelled = true;
      playbackStop?.();
      if (completionTimer) clearTimeout(completionTimer);
    };
  }, [baseSrc, playKey, durationMs, playbackRate, onComplete]);

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

function SkinBitmapDecoration({
  node,
  src,
}: {
  node: DecorationNode;
  src: string;
}) {
  const [ready, setReady] = useState(() => isSkinBitmapReady(src));

  useEffect(() => {
    if (isSkinBitmapReady(src)) {
      setReady(true);
      return;
    }

    let cancelled = false;
    setReady(false);
    loadSkinBitmap(src)
      .then(() => {
        if (!cancelled) setReady(true);
      })
      .catch((err) => {
        console.warn("SkinBitmapDecoration: failed to load bitmap", err);
      });

    return () => {
      cancelled = true;
    };
  }, [src]);

  return (
    <img
      className={[
        "skin-decoration",
        "skin-decoration--bitmap",
        node.dragRegion && "skin-decoration--drag",
      ]
        .filter(Boolean)
        .join(" ")}
      data-node-id={node.id}
      {...(node.dragRegion ? skinDragRegionDeepProps() : {})}
      src={src}
      alt=""
      style={{ opacity: ready ? 1 : 0 }}
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
    return (
      <div
        className={[
          "skin-decoration",
          node.className ?? "skin-decoration--default",
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

  const src = skinAssetFileUrl(pack.packDir, presentation.assets.default);

  return <SkinBitmapDecoration node={node} src={src} />;
}
