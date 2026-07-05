import { useState, type ReactNode } from "react";
import { NowPlayingMetadata } from "../NowPlayingMetadata/NowPlayingMetadata";
import { PlaybackTransport } from "../PlaybackTransport/PlaybackTransport";
import { QueueButton } from "../QueueButton/QueueButton";
import { SeekBar } from "../SeekBar/SeekBar";
import { VisualizerSlot } from "../VisualizerSlot/VisualizerSlot";
import { VolumeControl } from "../VolumeControl/VolumeControl";
import { SetListModal } from "../../SetListModal/SetListModal";
import { resolveVisualizerLayout } from "../../../lib/skinVisualizerLayout";
import { useSkinControlEnabled } from "../../../lib/skinBinds";
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
import "./SkinPrimitiveControl.css";

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
  const interactionEnabled = useSkinControlEnabled(node.enabledWhen);
  const prefix = classPrefix(node);

  let content: ReactNode = null;

  if (node.type === "artwork") {
    content = <NowPlayingMetadata showText={false} className={prefix} />;
  } else if (node.type === "transport") {
    content = (
      <PlaybackTransport
        className={[prefix, variantClass(node)].filter(Boolean).join(" ")}
      />
    );
  } else if (node.type === "seekbar") {
    content = <SeekBar className={[prefix, "skin-seekbar"].filter(Boolean).join(" ")} />;
  } else if (node.type === "visualizer") {
    const vizLayout = resolveVisualizerLayout(manifest);
    const presentationMini =
      node.presentation.kind === "primitive" &&
      node.presentation.variant === "mini";
    const variant = presentationMini && vizLayout.display === "mini" ? "mini" : vizLayout.variant;
    content = (
      <VisualizerSlot
        variant={variant}
        expanded={visualizerExpanded}
        onToggleExpand={onToggleVisualizer}
        showExpandToggle={vizLayout.showExpandToggle}
        fillContainer={vizLayout.fillContainer}
        className={[prefix, vizLayout.slotClassName].filter(Boolean).join(" ")}
        nodeId={node.id}
      />
    );
  } else if (node.type === "volume") {
    content = (
      <VolumeControl
        className={[prefix, variantClass(node)].filter(Boolean).join(" ")}
      />
    );
  } else if (node.type === "queue") {
    content = (
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

  if (!content) return null;

  return (
    <div
      className="skin-primitive-control"
      data-node-id={node.id}
      aria-disabled={!interactionEnabled || undefined}
      style={interactionEnabled ? undefined : { pointerEvents: "none" }}
    >
      {content}
    </div>
  );
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
