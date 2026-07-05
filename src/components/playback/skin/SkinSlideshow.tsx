import { skinAssetFileUrl } from "../../../lib/skinAssets";
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
  const assetPath = resolveSlideshowAssetForState(node, runtime);
  if (!assetPath) return null;

  const src = skinAssetFileUrl(pack.packDir, assetPath);

  return (
    <div
      className="skin-slideshow"
      data-node-id={node.id}
      style={{ backgroundImage: `url("${src}")` }}
      aria-hidden
    />
  );
}
