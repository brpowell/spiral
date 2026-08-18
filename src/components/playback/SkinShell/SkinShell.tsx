import type { CSSProperties, ReactNode } from "react";
import { useMemo, useState } from "react";
import { resolveVisualizerLayout } from "../../../lib/skinVisualizerLayout";
import type { SkinManifest } from "../../../types/skin";
import { NowPlayingMetadata } from "../NowPlayingMetadata/NowPlayingMetadata";
import { PlaybackTransport } from "../PlaybackTransport/PlaybackTransport";
import { QueueButton } from "../QueueButton/QueueButton";
import { SeekBar } from "../SeekBar/SeekBar";
import { SetListModal } from "../../SetListModal/SetListModal";
import { VisualizerSlot } from "../VisualizerSlot/VisualizerSlot";
import { VolumeControl } from "../VolumeControl/VolumeControl";
import { t } from "../../../lib/i18n";
import "./SkinShell.css";

export interface SkinShellSlots {
  header?: ReactNode;
  art?: ReactNode;
  info?: ReactNode;
  controls?: ReactNode;
  visualizer?: ReactNode;
  footer?: ReactNode;
}

export interface SkinShellProps extends SkinShellSlots {
  className?: string;
  manifest?: SkinManifest;
  /** When true, renders volume in the footer slot by default. */
  showVolume?: boolean;
  visualizerExpanded?: boolean;
  onToggleVisualizer?: () => void;
}

function DefaultArt() {
  return <NowPlayingMetadata showText={false} />;
}

function DefaultInfo() {
  return <NowPlayingMetadata showArt={false} />;
}

function DefaultControls() {
  return (
    <div className="skin-shell__controls-inner">
      <PlaybackTransport />
      <SeekBar className="skin-shell__seek" />
    </div>
  );
}

function DefaultVisualizer({
  expanded,
  onToggleExpand,
}: {
  expanded: boolean;
  onToggleExpand: () => void;
}) {
  return (
    <VisualizerSlot
      variant="mini"
      expanded={expanded}
      onToggleExpand={onToggleExpand}
      className="visualizer-slot--mini"
    />
  );
}

function DefaultFooter({ showVolume }: { showVolume: boolean }) {
  const [setListOpen, setSetListOpen] = useState(false);

  return (
    <>
      <div className="skin-shell__footer-inner">
        {showVolume ? <VolumeControl /> : null}
        <QueueButton onClick={() => setSetListOpen(true)} />
      </div>
      <SetListModal open={setListOpen} onClose={() => setSetListOpen(false)} />
    </>
  );
}

/**
 * Layout shell for skin mode views. Named slots are filled from skin manifests
 * via SkinLayoutRenderer; unset slots use the default Spiral layout.
 */
export function SkinShell({
  className,
  manifest,
  header,
  art,
  info,
  controls,
  visualizer,
  footer,
  showVolume = true,
  visualizerExpanded: visualizerExpandedProp,
  onToggleVisualizer: onToggleVisualizerProp,
}: SkinShellProps) {
  const [visualizerExpandedInternal, setVisualizerExpandedInternal] =
    useState(false);

  const vizLayout = useMemo(
    () => resolveVisualizerLayout(manifest),
    [manifest],
  );

  const visualizerExpanded =
    visualizerExpandedProp ?? visualizerExpandedInternal;
  const onToggleVisualizer =
    onToggleVisualizerProp ?? (() => setVisualizerExpandedInternal((v) => !v));

  const headerNode = header;
  const artNode = art ?? <DefaultArt />;
  const infoNode = info ?? <DefaultInfo />;
  const controlsNode = controls ?? <DefaultControls />;
  const visualizerNode = visualizer ?? (
    <DefaultVisualizer
      expanded={visualizerExpanded}
      onToggleExpand={onToggleVisualizer}
    />
  );
  const footerNode = footer ?? <DefaultFooter showVolume={showVolume} />;

  const shellClass = ["skin-shell", vizLayout.shellClassName, className]
    .filter(Boolean)
    .join(" ");

  const visualizerSlotStyle: CSSProperties | undefined =
    Object.keys(vizLayout.slotStyle).length > 0
      ? vizLayout.slotStyle
      : undefined;

  const slotOrder =
    vizLayout.placement === "top"
      ? (["header", "visualizer", "art", "info", "controls", "footer"] as const)
      : ([
          "header",
          "art",
          "info",
          "controls",
          "visualizer",
          "footer",
        ] as const);

  const slotNodes: Record<
    (typeof slotOrder)[number],
    { node: ReactNode; style?: CSSProperties }
  > = {
    header: { node: headerNode },
    art: { node: artNode },
    info: { node: infoNode },
    controls: { node: controlsNode },
    visualizer: { node: visualizerNode, style: visualizerSlotStyle },
    footer: { node: footerNode },
  };

  return (
    <div className={shellClass} aria-label={t("playback:skinMode.playerAria")}>
      {slotOrder.map((area) => {
        const { node, style } = slotNodes[area];
        return node ? (
          <div
            key={area}
            className={`skin-shell__slot skin-shell__slot--${area}`}
            style={style}
          >
            {node}
          </div>
        ) : null;
      })}
    </div>
  );
}
