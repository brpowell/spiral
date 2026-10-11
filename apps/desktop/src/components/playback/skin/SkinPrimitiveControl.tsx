import { NowPlayingArt } from "../NowPlayingArt/NowPlayingArt";
import { SeekBar } from "../SeekBar/SeekBar";
import { VisualizerSlot } from "../VisualizerSlot/VisualizerSlot";
import { VolumeControl } from "../VolumeControl/VolumeControl";
import { useSkinControlEnabled } from "../../../lib/skinBinds";
import {
  styleFromSkinNode,
  useResolvedNodeStyle,
} from "../../../lib/skinNodeStyle";
import type {
  ArtworkNode,
  SliderSeekNode,
  SliderVolumeNode,
  VisualizerNode,
} from "../../../types/skin";

type PrimitiveNode =
  ArtworkNode | VisualizerNode | SliderSeekNode | SliderVolumeNode;

export function SkinPrimitiveControl({ node }: { node: PrimitiveNode }) {
  const interactionEnabled = useSkinControlEnabled(node.enabledWhen);
  const resolvedStyle = useResolvedNodeStyle(node.style, node.styleWhen);
  const css = styleFromSkinNode(resolvedStyle, {
    omitOpacity: node.bounds !== undefined,
  });
  const className = node.className;

  if (node.type === "artwork") {
    return (
      <NowPlayingArt
        className={className}
        nodeId={node.id}
        interactionEnabled={interactionEnabled}
        style={resolvedStyle}
        objectFit={node.objectFit}
      />
    );
  }

  if (node.type === "slider" && node.control === "seek") {
    return (
      <SeekBar
        className={className}
        nodeId={node.id}
        interactionEnabled={interactionEnabled}
      />
    );
  }

  if (node.type === "visualizer") {
    return (
      <VisualizerSlot
        variant="dock"
        showExpandToggle={false}
        fillContainer
        className={className}
        nodeId={node.id}
        interactionEnabled={interactionEnabled}
        style={css}
      />
    );
  }

  if (node.type === "slider" && node.control === "volume") {
    return (
      <VolumeControl
        className={className}
        nodeId={node.id}
        interactionEnabled={interactionEnabled}
      />
    );
  }

  return null;
}
