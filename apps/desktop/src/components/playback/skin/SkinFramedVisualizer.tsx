import { useMemo, type CSSProperties } from "react";
import { VisualizerSlot } from "../VisualizerSlot/VisualizerSlot";
import { skinAssetFileUrl } from "../../../lib/skinAssets";
import type {
  FramedPanelPresentation,
  LoadedSkinPack,
  VisualizerNode,
} from "../../../types/skin";
import "./SkinFramedVisualizer.css";

export function SkinFramedVisualizer({
  node,
  pack,
}: {
  node: VisualizerNode;
  pack: LoadedSkinPack;
}) {
  const presentation = node.presentation as FramedPanelPresentation;
  const maskUrl = skinAssetFileUrl(pack.packDir, presentation.mask);
  const frameUrl = presentation.frame
    ? skinAssetFileUrl(pack.packDir, presentation.frame)
    : null;

  const contentStyle = useMemo((): CSSProperties => {
    const inset = presentation.contentInset;
    const base: CSSProperties = {
      WebkitMaskImage: `url("${maskUrl}")`,
      maskImage: `url("${maskUrl}")`,
    };
    if (inset) {
      return {
        ...base,
        left: `${inset.x}px`,
        top: `${inset.y}px`,
        width: `${inset.w}px`,
        height: `${inset.h}px`,
        right: "auto",
        bottom: "auto",
      };
    }
    return base;
  }, [maskUrl, presentation.contentInset]);

  return (
    <div
      className={["skin-framed-viz", node.className].filter(Boolean).join(" ")}
      data-node-id={node.id}
    >
      <div
        className={[
          "skin-framed-viz__content",
          presentation.contentInset && "skin-framed-viz__content--inset",
        ]
          .filter(Boolean)
          .join(" ")}
        style={contentStyle}
      >
        <VisualizerSlot variant="dock" showExpandToggle={false} fillContainer />
      </div>
      {frameUrl ? (
        <img
          className="skin-framed-viz__frame"
          src={frameUrl}
          alt=""
          draggable={false}
        />
      ) : null}
    </div>
  );
}
