import { useMemo, type CSSProperties } from "react";
import { VisualizerSlot } from "../VisualizerSlot/VisualizerSlot";
import { resolveVisualizerLayout } from "../../../lib/skinVisualizerLayout";
import { skinAssetUrl } from "../../../lib/skinAssets";
import type {
  FramedPanelPresentation,
  LoadedSkinPack,
  SkinManifest,
  VisualizerNode,
} from "../../../types/skin";
import "./SkinFramedVisualizer.css";

export function SkinFramedVisualizer({
  node,
  pack,
  manifest,
  visualizerExpanded,
  onToggleVisualizer,
}: {
  node: VisualizerNode;
  pack: LoadedSkinPack;
  manifest?: SkinManifest;
  visualizerExpanded: boolean;
  onToggleVisualizer: () => void;
}) {
  const presentation = node.presentation as FramedPanelPresentation;
  const vizLayout = resolveVisualizerLayout(manifest);
  const maskUrl = skinAssetUrl(pack.packDir, presentation.mask);
  const frameUrl = presentation.frame
    ? skinAssetUrl(pack.packDir, presentation.frame)
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
      className={[
        "skin-framed-viz",
        presentation.classPrefix,
      ]
        .filter(Boolean)
        .join(" ")}
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
        <VisualizerSlot
          variant={vizLayout.variant}
          expanded={visualizerExpanded}
          onToggleExpand={onToggleVisualizer}
          showExpandToggle={vizLayout.showExpandToggle}
          fillContainer={vizLayout.fillContainer}
          className={vizLayout.slotClassName}
        />
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
