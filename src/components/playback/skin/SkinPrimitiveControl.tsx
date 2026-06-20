import { useState } from "react";
import { NowPlayingMetadata } from "../NowPlayingMetadata/NowPlayingMetadata";
import { PlaybackTransport } from "../PlaybackTransport/PlaybackTransport";
import { QueueButton } from "../QueueButton/QueueButton";
import { SeekBar } from "../SeekBar/SeekBar";
import { VisualizerSlot } from "../VisualizerSlot/VisualizerSlot";
import { VolumeControl } from "../VolumeControl/VolumeControl";
import { SetListModal } from "../../SetListModal/SetListModal";
import { resolveVisualizerLayout } from "../../../lib/skinVisualizerLayout";
import type {
  ArtworkNode,
  ControlNodeBase,
  QueueNode,
  SeekbarNode,
  SkinManifest,
  TransportNode,
  VisualizerNode,
  VolumeNode,
} from "../../../types/skin";

type PrimitiveNode =
  | ArtworkNode
  | SeekbarNode
  | TransportNode
  | VisualizerNode
  | VolumeNode
  | QueueNode;

export function SkinPrimitiveControl({
  node,
  manifest,
  visualizerExpanded,
  onToggleVisualizer,
  onOpenQueue,
}: {
  node: PrimitiveNode;
  manifest?: SkinManifest;
  visualizerExpanded: boolean;
  onToggleVisualizer: () => void;
  onOpenQueue: () => void;
}) {
  const [setListOpen, setSetListOpen] = useState(false);
  const prefix = classPrefix(node);

  if (node.type === "artwork") {
    return <NowPlayingMetadata showText={false} className={prefix} />;
  }

  if (node.type === "transport") {
    return (
      <PlaybackTransport
        className={[prefix, variantClass(node)].filter(Boolean).join(" ")}
      />
    );
  }

  if (node.type === "seekbar") {
    return <SeekBar className={[prefix, "skin-seekbar"].filter(Boolean).join(" ")} />;
  }

  if (node.type === "visualizer") {
    const vizLayout = resolveVisualizerLayout(manifest);
    const presentationMini =
      node.presentation.kind === "primitive" &&
      node.presentation.variant === "mini";
    const variant = presentationMini && vizLayout.display === "mini" ? "mini" : vizLayout.variant;
    return (
      <VisualizerSlot
        variant={variant}
        expanded={visualizerExpanded}
        onToggleExpand={onToggleVisualizer}
        showExpandToggle={vizLayout.showExpandToggle}
        fillContainer={vizLayout.fillContainer}
        className={[prefix, vizLayout.slotClassName].filter(Boolean).join(" ")}
      />
    );
  }

  if (node.type === "volume") {
    return (
      <VolumeControl
        className={[prefix, variantClass(node)].filter(Boolean).join(" ")}
      />
    );
  }

  if (node.type === "queue") {
    return (
      <>
        <QueueButton
          onClick={() => {
            onOpenQueue();
            setSetListOpen(true);
          }}
        />
        <SetListModal
          open={setListOpen}
          onClose={() => setSetListOpen(false)}
        />
      </>
    );
  }

  return null;
}

function classPrefix(node: ControlNodeBase): string | undefined {
  if (node.presentation.kind === "primitive") {
    return node.presentation.classPrefix;
  }
  return undefined;
}

function variantClass(node: ControlNodeBase): string | undefined {
  if (node.presentation.kind === "primitive" && node.presentation.variant) {
    return `${node.presentation.classPrefix ?? "skin"}--${node.presentation.variant}`;
  }
  return undefined;
}
