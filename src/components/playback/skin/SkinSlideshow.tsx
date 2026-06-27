import { skinAssetUrl } from "../../../lib/skinAssets";
import { resolveSlideshowAssetForState } from "../../../lib/skinSlideshow";
import { useSkinSlideshowState } from "../../../lib/skinSlideshowContext";
import type { LoadedSkinPack, SlideshowNode } from "../../../types/skin";
import "./SkinSlideshow.css";

export function SkinSlideshow({
  node,
  pack,
}: {
  node: SlideshowNode;
  pack: LoadedSkinPack;
}) {
  const { state } = useSkinSlideshowState();
  const runtime = node.id ? state[node.id] : undefined;
  const assetBase = resolveSlideshowAssetForState(node, runtime);
  if (!assetBase) return null;

  const src = skinAssetUrl(pack.packDir, assetBase);

  return (
    <div
      className="skin-slideshow"
      data-node-id={node.id}
      style={{ backgroundImage: `url("${src}")` }}
      aria-hidden
    />
  );
}
