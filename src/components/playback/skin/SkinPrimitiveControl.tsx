import { NowPlayingArt } from "../NowPlayingArt/NowPlayingArt";
import { PlaybackTransport } from "../PlaybackTransport/PlaybackTransport";
import { SeekBar } from "../SeekBar/SeekBar";
import { VisualizerSlot } from "../VisualizerSlot/VisualizerSlot";
import { VolumeControl } from "../VolumeControl/VolumeControl";
import { useSkinControlEnabled } from "../../../lib/skinBinds";
import type {
  ArtworkNode,
  SeekbarNode,
  TransportNode,
  VisualizerNode,
  VolumeNode,
} from "../../../types/skin";

type PrimitiveNode =
  ArtworkNode | SeekbarNode | TransportNode | VisualizerNode | VolumeNode;

export function SkinPrimitiveControl({ node }: { node: PrimitiveNode }) {
  const interactionEnabled = useSkinControlEnabled(node.enabledWhen);
  const className = node.className;

  if (node.type === "artwork") {
    return (
      <NowPlayingArt
        className={className}
        nodeId={node.id}
        interactionEnabled={interactionEnabled}
      />
    );
  }

  if (node.type === "transport") {
    return (
      <PlaybackTransport
        className={className}
        nodeId={node.id}
        interactionEnabled={interactionEnabled}
      />
    );
  }

  if (node.type === "seekbar") {
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
      />
    );
  }

  if (node.type === "volume") {
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
