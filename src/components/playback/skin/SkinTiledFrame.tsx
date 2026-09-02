import { Children, useMemo, type CSSProperties, type ReactNode } from "react";
import { skinAssetFileUrl } from "../../../lib/skinAssets";
import {
  computeChromeClipPath,
  computeContentRect,
  computeTiledFrameLayoutRects,
  computeTilePaintSlices,
  partitionTiledFrameRects,
  tiledFrameChromeShouldClip,
  tiledFrameContentRadius,
  tiledFrameTilesStackWithSiblings,
  TILED_FRAME_CONTENT_Z,
  type FrameRect,
  type TilePaintSlice,
} from "../../../lib/skinTiledFrame";
import type { LoadedSkinPack, TiledFrameNode } from "../../../types/skin";
import {
  SkinCanvasStageContext,
  useSkinCanvasStage,
} from "./SkinCanvasStageContext";
import {
  SkinLayoutContextProvider,
  useSkinLayoutContext,
} from "./SkinLayoutContext";
import "./SkinTiledFrame.css";

export interface SkinTiledFrameProps {
  node: TiledFrameNode;
  pack: LoadedSkinPack;
  children: ReactNode;
}

function tileStyle(
  pack: LoadedSkinPack,
  tile: FrameRect,
  slice: TilePaintSlice,
): CSSProperties {
  const url = skinAssetFileUrl(pack.packDir, tile.asset);
  const { tiled, w, h, tileUnitW, tileUnitH } = tile;
  const unitW = tileUnitW ?? w;
  const unitH = tileUnitH ?? h;
  const style: CSSProperties = {
    backgroundImage: `url("${url}")`,
    backgroundSize: tiled ? `${unitW}px ${unitH}px` : `${w}px ${h}px`,
    backgroundPosition: `${tile.x - slice.x}px ${tile.y - slice.y}px`,
  };
  if (!slice.maskCap) return style;
  const maskUrl = skinAssetFileUrl(pack.packDir, slice.maskCap.asset);
  const maskSize = `${slice.maskCap.w}px ${slice.maskCap.h}px`;
  const maskPos = `${slice.maskCap.x - slice.x}px ${slice.maskCap.y - slice.y}px`;
  return {
    ...style,
    WebkitMaskImage: `url("${maskUrl}")`,
    maskImage: `url("${maskUrl}")`,
    WebkitMaskSize: maskSize,
    maskSize: maskSize,
    WebkitMaskPosition: maskPos,
    maskPosition: maskPos,
    WebkitMaskRepeat: "no-repeat",
    maskRepeat: "no-repeat",
  };
}

export function SkinTiledFrame({ node, pack, children }: SkinTiledFrameProps) {
  const { stageSize } = useSkinCanvasStage();
  const parentLayout = useSkinLayoutContext();
  const presentation = node.presentation;
  const { width, height } = stageSize;

  const contentRect = useMemo(
    () => computeContentRect(width, height, presentation.contentInset),
    [width, height, presentation.contentInset],
  );

  const tiles = useMemo(
    () => computeTiledFrameLayoutRects(width, height, presentation),
    [width, height, presentation],
  );

  const { underContentTiles, overContentTiles } = useMemo(
    () => partitionTiledFrameRects(tiles),
    [tiles],
  );

  const childStageContext = useMemo(() => ({ stageSize }), [stageSize]);

  const contentLayoutContext = useMemo(
    () => ({
      origin: {
        x: parentLayout.origin.x + contentRect.x,
        y: parentLayout.origin.y + contentRect.y,
      },
      size: { width: contentRect.w, height: contentRect.h },
      space: "content" as const,
    }),
    [parentLayout.origin.x, parentLayout.origin.y, contentRect],
  );

  const contentRadius = tiledFrameContentRadius(presentation);

  const chromeClip = useMemo(
    () =>
      tiledFrameChromeShouldClip(presentation.contentInset)
        ? computeChromeClipPath(width, height, contentRect, contentRadius)
        : undefined,
    [contentRect, contentRadius, presentation.contentInset, width, height],
  );

  const hasContent = Children.toArray(children).length > 0;
  const stackTilesWithSiblings = tiledFrameTilesStackWithSiblings(
    presentation.contentInset,
  );

  const renderTile = (tile: FrameRect) =>
    computeTilePaintSlices(tile, tiles).map((slice, sliceIndex) => (
      <div
        key={`${node.id ?? "frame"}-tile-${tile.tileIndex}-${sliceIndex}`}
        className={[
          "skin-tiled-frame__tile",
          tile.tiled === "horizontal" && "skin-tiled-frame__tile--tile-x",
          tile.tiled === "vertical" && "skin-tiled-frame__tile--tile-y",
        ]
          .filter(Boolean)
          .join(" ")}
        style={{
          left: `${slice.x}px`,
          top: `${slice.y}px`,
          width: `${slice.w}px`,
          height: `${slice.h}px`,
          zIndex: tile.zIndex,
          ...tileStyle(pack, tile, slice),
        }}
        aria-hidden
      />
    ));

  return (
    <div className="skin-tiled-frame" data-node-id={node.id}>
      <div
        className={[
          "skin-tiled-frame__layer",
          "skin-tiled-frame__layer--stretch",
          stackTilesWithSiblings && "skin-tiled-frame__layer--stage-stack",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {underContentTiles.map(renderTile)}
      </div>
      {hasContent ? (
        <div
          className="skin-tiled-frame__content"
          style={{
            left: `${contentRect.x}px`,
            top: `${contentRect.y}px`,
            width: `${contentRect.w}px`,
            height: `${contentRect.h}px`,
            zIndex: TILED_FRAME_CONTENT_Z,
            borderRadius: contentRadius > 0 ? `${contentRadius}px` : undefined,
          }}
        >
          <SkinCanvasStageContext.Provider value={childStageContext}>
            <SkinLayoutContextProvider value={contentLayoutContext}>
              {children}
            </SkinLayoutContextProvider>
          </SkinCanvasStageContext.Provider>
        </div>
      ) : null}
      <div
        className={[
          "skin-tiled-frame__layer",
          "skin-tiled-frame__layer--chrome",
          stackTilesWithSiblings && "skin-tiled-frame__layer--stage-stack",
        ]
          .filter(Boolean)
          .join(" ")}
        style={
          chromeClip
            ? { clipPath: chromeClip, WebkitClipPath: chromeClip }
            : undefined
        }
      >
        {overContentTiles.map(renderTile)}
      </div>
    </div>
  );
}
