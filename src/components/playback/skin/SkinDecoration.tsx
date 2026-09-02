import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  resolveInteractiveAssetUrl,
  skinAssetFileUrl,
} from "../../../lib/skinAssets";
import {
  getSkinBitmapIfReady,
  isSkinBitmapReady,
  loadSkinBitmap,
} from "../../../lib/skinBitmapCache";
import { preloadInteractiveBitmapAssets } from "../../../lib/skinViewAssetPreload";
import {
  getDecodedSkinGif,
  loadSkinGif,
  playSkinGifOnCanvas,
  type DecodedSkinGif,
} from "../../../lib/skinGifPlayback";
import { scheduleSkinEffects } from "../../../lib/skinEffects";
import { useSkinBindState } from "../../../lib/skinBinds";
import { skinDragRegionDeepProps } from "../../../lib/skinDragRegion";
import type {
  BitmapPresentation,
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
  const baseSrc = skinAssetFileUrl(pack.packDir, presentation.asset);
  const [frameReady, setFrameReady] = useState(() =>
    Boolean(getDecodedSkinGif(baseSrc)),
  );
  const { durationMs, playbackRate, onComplete } = presentation;

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let playbackStop: (() => void) | undefined;
    let completionTimer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    const fireComplete = () => {
      if (!onComplete?.length) return;
      scheduleSkinEffects(onComplete, () => bindStateRef.current);
    };

    const play = (decoded: DecodedSkinGif) => {
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
    };

    // Preloaded segments must paint in the commit that mounts them. Awaiting a
    // tick leaves a transparent canvas over whatever the previous phase drew,
    // which reads as a flash when view state chains one segment into the next.
    const decoded = getDecodedSkinGif(baseSrc);
    if (decoded) {
      play(decoded);
      return () => {
        cancelled = true;
        playbackStop?.();
      };
    }

    setFrameReady(false);
    loadSkinGif(baseSrc)
      .then(play)
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

function drawBitmap(canvas: HTMLCanvasElement, image: HTMLImageElement): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  ctx.drawImage(image, 0, 0);
}

function SkinBitmapDecoration({
  node,
  pack,
  presentation,
}: {
  node: DecorationNode;
  pack: LoadedSkinPack;
  presentation: BitmapPresentation;
}) {
  const bindState = useSkinBindState();
  const src = resolveInteractiveAssetUrl(
    pack.packDir,
    presentation.assets,
    presentation.assetsWhen,
    bindState,
    "default",
  );
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(() => isSkinBitmapReady(src));

  useEffect(() => {
    preloadInteractiveBitmapAssets(
      pack.packDir,
      presentation.assets,
      presentation.assetsWhen,
    );
  }, [pack.packDir, presentation.assets, presentation.assetsWhen]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;
    const cached = getSkinBitmapIfReady(src);
    if (cached) {
      drawBitmap(canvas, cached);
      setReady(true);
      return;
    }

    void loadSkinBitmap(src)
      .then((image) => {
        if (cancelled) return;
        drawBitmap(canvas, image);
        setReady(true);
      })
      .catch((err) => {
        console.warn("SkinBitmapDecoration: failed to load bitmap", err);
      });

    return () => {
      cancelled = true;
    };
  }, [src]);

  return (
    <canvas
      ref={canvasRef}
      className={[
        "skin-decoration",
        "skin-decoration--bitmap",
        node.dragRegion && "skin-decoration--drag",
      ]
        .filter(Boolean)
        .join(" ")}
      data-node-id={node.id}
      data-asset-url={src}
      {...(node.dragRegion ? skinDragRegionDeepProps() : {})}
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

  return (
    <SkinBitmapDecoration node={node} pack={pack} presentation={presentation} />
  );
}
