import { useMemo, type CSSProperties, type ReactNode } from "react";
import { skinAssetFileUrl } from "../../../lib/skinAssets";
import {
  computeChromeClipPath,
  computeContentRect,
  computeTiledFrameLayoutRects,
  partitionTiledFrameRects,
  TILED_FRAME_CONTENT_Z,
} from "../../../lib/skinTiledFrame";
import type { LoadedSkinPack, TiledFrameNode } from "../../../types/skin";
import {
  SkinCanvasStageContext,
  useSkinCanvasStage,
} from "./SkinCanvasStageContext";
import "./SkinTiledFrame.css";

export interface SkinTiledFrameProps {
  node: TiledFrameNode;
  pack: LoadedSkinPack;
  children: ReactNode;
}

function tileStyle(
  pack: LoadedSkinPack,
  tile: {
    asset: string;
    w: number;
    h: number;
    tiled: "horizontal" | "vertical" | false;
    tileUnitW?: number;
    tileUnitH?: number;
  },
): CSSProperties {
  const url = skinAssetFileUrl(pack.packDir, tile.asset);
  const { tiled, w, h, tileUnitW, tileUnitH } = tile;
  const unitW = tileUnitW ?? w;
  const unitH = tileUnitH ?? h;
  return {
    backgroundImage: `url("${url}")`,
    backgroundSize: tiled ? `${unitW}px ${unitH}px` : `${w}px ${h}px`,
  };
}

export function SkinTiledFrame({ node, pack, children }: SkinTiledFrameProps) {
  const { stageSize } = useSkinCanvasStage();
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

  const childContext = useMemo(() => ({ stageSize }), [stageSize]);

  const chromeClip = useMemo(
    () => computeChromeClipPath(width, height, contentRect),
    [contentRect, width, height],
  );

  const renderTile = (tile: (typeof tiles)[number]) => (
    <div
      key={`${node.id ?? "frame"}-tile-${tile.tileIndex}`}
      className={[
        "skin-tiled-frame__tile",
        tile.tiled === "horizontal" && "skin-tiled-frame__tile--tile-x",
        tile.tiled === "vertical" && "skin-tiled-frame__tile--tile-y",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{
        left: `${tile.x}px`,
        top: `${tile.y}px`,
        width: `${tile.w}px`,
        height: `${tile.h}px`,
        zIndex: tile.zIndex,
        ...tileStyle(pack, tile),
      }}
      aria-hidden
    />
  );

  return (
    <div className="skin-tiled-frame" data-node-id={node.id}>
      <div className="skin-tiled-frame__layer skin-tiled-frame__layer--stretch">
        {underContentTiles.map(renderTile)}
      </div>
      <div
        className="skin-tiled-frame__content"
        style={{
          left: `${contentRect.x}px`,
          top: `${contentRect.y}px`,
          width: `${contentRect.w}px`,
          height: `${contentRect.h}px`,
          zIndex: TILED_FRAME_CONTENT_Z,
        }}
      >
        <SkinCanvasStageContext.Provider value={childContext}>
          {children}
        </SkinCanvasStageContext.Provider>
      </div>
      <div
        className="skin-tiled-frame__layer skin-tiled-frame__layer--chrome"
        style={{ clipPath: chromeClip, WebkitClipPath: chromeClip }}
      >
        {overContentTiles.map(renderTile)}
      </div>
    </div>
  );
}
