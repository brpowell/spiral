import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { skinPreviewUrl } from "../../lib/skinAssets";
import { useVisualizerStore } from "../../store/useVisualizerStore";
import type { VizSummary } from "../../types/visualizer";
import { usePrefersReducedMotion } from "../visualizer/context";
import { BrowseGridBody } from "../BrowseView/BrowseGridBody";
import { BrowseView } from "../BrowseView/BrowseView";
import { BrowseViewHeader } from "../BrowseView/BrowseViewHeader";
import { ItemActionsMenu } from "./ItemActionsMenu";
import { ItemUpdateButton } from "./ItemUpdateButton";
import { AppearancePackCard } from "./AppearancePackCard";
import { VizCardLivePreview } from "./VizCardLivePreview";
import { useVizCardHover } from "./useVizCardHover";
import { useVizCardSnapshot } from "./vizCardSnapshot";
import "./VisualizersSection.css";
import "./AppearanceSection.css";

export function VizCardPreview({
  pack,
  live,
  themed = false,
}: {
  pack: VizSummary;
  live: boolean;
  /** Use the theme's colours instead of the loaded track's cover. */
  themed?: boolean;
}) {
  const authored = skinPreviewUrl(pack.previewPath);
  // Skip snapshot queue when an authored preview image exists.
  const snapshotSrc = useVizCardSnapshot(authored ? "" : pack.id, {
    themed,
  });
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
          themed={themed}
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
  onOpenItem,
  onPointerEnter,
  onPointerLeave,
}: {
  pack: VizSummary;
  active: boolean;
  live: boolean;
  onSelect: () => void;
  onOpenItem: (effectiveId: string) => void;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
}) {
  const { t } = useTranslation("studio");
  return (
    <AppearancePackCard
      active={active}
      name={pack.name}
      author={pack.author}
      description={pack.description}
      ariaLabel={t("items.cardAria", { name: pack.name, author: pack.author })}
      preview={<VizCardPreview pack={pack} live={live} />}
      previewClassName="visualizer-picker__preview"
      linked={pack.zone === "linked"}
      previewAction={
        <ItemUpdateButton
          effectiveId={pack.id}
          zone={pack.zone}
          name={pack.name}
        />
      }
      actions={
        <ItemActionsMenu
          item={{
            effectiveId: pack.id,
            type: "visualizer",
            name: pack.name,
            zone: pack.zone,
          }}
          onOpenItem={onOpenItem}
        />
      }
      onApply={onSelect}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    />
  );
}

export function VisualizersSection({
  onOpenItem,
}: {
  onOpenItem: (effectiveId: string) => void;
}) {
  const { t } = useTranslation(["studio", "library"]);
  const visualizers = useVisualizerStore((s) => s.visualizers);
  const activeVisualizerId = useVisualizerStore((s) => s.activeVisualizerId);
  const setActiveVisualizer = useVisualizerStore((s) => s.setActiveVisualizer);
  const reducedMotion = usePrefersReducedMotion();

  const {
    hoveredId,
    onEnter: onCardPointerEnter,
    onLeave: onCardPointerLeave,
  } = useVizCardHover(reducedMotion);

  const liveId = reducedMotion ? null : (hoveredId ?? activeVisualizerId);

  return (
    <BrowseView>
      <BrowseViewHeader
        className="browse-view__header--single-row"
        title={t("visualizers.title")}
        count={
          visualizers.length > 0
            ? t("library:views.headerCount", { count: visualizers.length })
            : undefined
        }
      />

      <BrowseGridBody>
        {visualizers.length === 0 ? (
          <p className="browse-view__empty">{t("visualizers.loading")}</p>
        ) : (
          <div className="appearance-pack-grid" role="list">
            {visualizers.map((pack) => (
              <div key={pack.id} role="listitem">
                <VizCard
                  pack={pack}
                  active={pack.id === activeVisualizerId}
                  live={liveId === pack.id}
                  onSelect={() => void setActiveVisualizer(pack.id)}
                  onOpenItem={onOpenItem}
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
