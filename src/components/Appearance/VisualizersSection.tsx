import { useCallback, useEffect, useRef, useState } from "react";
import { skinPreviewUrl } from "../../lib/skinAssets";
import { useVisualizerStore } from "../../store/useVisualizerStore";
import type { VizSummary } from "../../types/visualizer";
import { usePrefersReducedMotion } from "../visualizer/context";
import { BrowseGridBody } from "../BrowseView/BrowseGridBody";
import { BrowseView } from "../BrowseView/BrowseView";
import { BrowseViewHeader } from "../BrowseView/BrowseViewHeader";
import { AppearancePackActions } from "./AppearancePackActions";
import { AppearancePackCard } from "./AppearancePackCard";
import { VizCardLivePreview } from "./VizCardLivePreview";
import { useVizCardSnapshot } from "./vizCardSnapshot";
import "./VisualizersSection.css";
import "./AppearanceSection.css";

const HOVER_ENTER_MS = 50;
const HOVER_LEAVE_MS = 300;

function VizCardPreview({
  pack,
  live,
}: {
  pack: VizSummary;
  live: boolean;
}) {
  const authored = skinPreviewUrl(pack.previewPath);
  // Skip snapshot queue when an authored preview image exists.
  const snapshotSrc = useVizCardSnapshot(authored ? "" : pack.id);
  const underlaySrc = authored ?? snapshotSrc;
  const [liveReady, setLiveReady] = useState(false);

  useEffect(() => {
    if (!live) setLiveReady(false);
  }, [live]);

  const hideUnderlay = live && liveReady;

  return (
    <>
      {underlaySrc ? (
        <img
          src={underlaySrc}
          alt=""
          className={[
            "visualizer-picker__preview-img",
            hideUnderlay ? "visualizer-picker__preview-img--hidden" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        />
      ) : hideUnderlay ? null : (
        <span className="visualizer-picker__preview-pending" />
      )}
      {live ? (
        <VizCardLivePreview
          visualizerId={pack.id}
          onReady={() => setLiveReady(true)}
        />
      ) : null}
    </>
  );
}

function VizCard({
  pack,
  active,
  live,
  onSelect,
  onOpenPack,
  onPointerEnter,
  onPointerLeave,
}: {
  pack: VizSummary;
  active: boolean;
  live: boolean;
  onSelect: () => void;
  onOpenPack: (packId: string) => void;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
}) {
  return (
    <AppearancePackCard
      active={active}
      name={pack.name}
      author={pack.author}
      packName={pack.packName || pack.packId}
      packId={pack.packId}
      description={pack.description}
      ariaLabel={`${pack.name} by ${pack.author}`}
      preview={<VizCardPreview pack={pack} live={live} />}
      previewClassName="visualizer-picker__preview"
      actions={
        pack.packId ? (
          <AppearancePackActions
            name={pack.name}
            packId={pack.packId}
            onOpenPack={onOpenPack}
          />
        ) : undefined
      }
      onApply={onSelect}
      onOpenPack={onOpenPack}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    />
  );
}

export function VisualizersSection({
  onOpenPack,
}: {
  onOpenPack: (packId: string) => void;
}) {
  const visualizers = useVisualizerStore((s) => s.visualizers);
  const activeVisualizerId = useVisualizerStore((s) => s.activeVisualizerId);
  const setActiveVisualizer = useVisualizerStore((s) => s.setActiveVisualizer);
  const reducedMotion = usePrefersReducedMotion();

  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const enterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingHoverRef = useRef<string | null>(null);

  const clearTimers = useCallback(() => {
    if (enterTimerRef.current) {
      clearTimeout(enterTimerRef.current);
      enterTimerRef.current = null;
    }
    if (leaveTimerRef.current) {
      clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
  }, []);

  useEffect(() => () => clearTimers(), [clearTimers]);

  const onCardPointerEnter = useCallback(
    (id: string) => {
      if (reducedMotion) return;
      pendingHoverRef.current = id;
      if (leaveTimerRef.current) {
        clearTimeout(leaveTimerRef.current);
        leaveTimerRef.current = null;
      }
      if (enterTimerRef.current) clearTimeout(enterTimerRef.current);
      enterTimerRef.current = setTimeout(() => {
        enterTimerRef.current = null;
        if (pendingHoverRef.current === id) {
          setHoveredId(id);
        }
      }, HOVER_ENTER_MS);
    },
    [reducedMotion],
  );

  const onCardPointerLeave = useCallback((id: string) => {
    if (pendingHoverRef.current === id) {
      pendingHoverRef.current = null;
    }
    if (enterTimerRef.current) {
      clearTimeout(enterTimerRef.current);
      enterTimerRef.current = null;
    }
    if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
    leaveTimerRef.current = setTimeout(() => {
      leaveTimerRef.current = null;
      setHoveredId((current) => (current === id ? null : current));
    }, HOVER_LEAVE_MS);
  }, []);

  const liveId = reducedMotion
    ? null
    : (hoveredId ?? activeVisualizerId);

  return (
    <BrowseView>
      <BrowseViewHeader
        title="Visualizers"
        count={visualizers.length > 0 ? `(${visualizers.length})` : undefined}
      />

      <BrowseGridBody>
        {visualizers.length === 0 ? (
          <p className="browse-view__empty">Loading visualizers…</p>
        ) : (
          <div className="appearance-pack-grid" role="list">
            {visualizers.map((pack) => (
              <div key={pack.id} role="listitem">
                <VizCard
                  pack={pack}
                  active={pack.id === activeVisualizerId}
                  live={liveId === pack.id}
                  onSelect={() => void setActiveVisualizer(pack.id)}
                  onOpenPack={onOpenPack}
                  onPointerEnter={() => onCardPointerEnter(pack.id)}
                  onPointerLeave={() => onCardPointerLeave(pack.id)}
                />
              </div>
            ))}
          </div>
        )}
      </BrowseGridBody>
    </BrowseView>
  );
}
