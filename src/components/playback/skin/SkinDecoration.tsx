import { skinAssetUrl, skinGifAssetUrl } from "../../../lib/skinAssets";
import { skinDragRegionDeepProps } from "../../../lib/skinDragRegion";
import type { DecorationNode, LoadedSkinPack } from "../../../types/skin";
import "./SkinDecoration.css";

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
    const src = skinGifAssetUrl(pack.packDir, presentation.assetBase);
    return (
      <img
        className={[
          "skin-decoration",
          "skin-decoration--gif",
          node.dragRegion && "skin-decoration--drag",
        ]
          .filter(Boolean)
          .join(" ")}
        data-node-id={node.id}
        {...(node.dragRegion ? skinDragRegionDeepProps() : {})}
        src={src}
        alt=""
        draggable={false}
      />
    );
  }

  if (presentation.kind !== "bitmap") return null;

  const src = skinAssetUrl(pack.packDir, presentation.assetBase);

  return (
    <img
      className={[
        "skin-decoration",
        node.dragRegion && "skin-decoration--drag",
      ]
        .filter(Boolean)
        .join(" ")}
      data-node-id={node.id}
      {...(node.dragRegion ? skinDragRegionDeepProps() : {})}
      src={src}
      alt=""
      draggable={false}
    />
  );
}
