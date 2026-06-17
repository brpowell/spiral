import { skinPreviewUrl } from "../../lib/skinAssets";
import { useVisualizerStore } from "../../store/useVisualizerStore";
import type { VizSummary } from "../../types/visualizer";
import { Button } from "../common/Button/Button";
import { AppearancePackCard } from "./AppearancePackCard";
import { useOpenAppearancePackDetail } from "./AppearancePackDetailContext";
import "./VisualizersSection.css";
import "./AppearanceSection.css";

function VizCardPreview({ pack }: { pack: VizSummary }) {
  const preview = skinPreviewUrl(pack.previewPath);

  if (preview) {
    return (
      <img src={preview} alt="" className="visualizer-picker__preview-img" />
    );
  }

  return (
    <span className="visualizer-picker__preview-fallback">
      <span className="visualizer-picker__bar" />
      <span className="visualizer-picker__bar visualizer-picker__bar--mid" />
      <span className="visualizer-picker__bar visualizer-picker__bar--tall" />
      <span className="visualizer-picker__bar visualizer-picker__bar--mid" />
      <span className="visualizer-picker__bar" />
    </span>
  );
}

function VizCard({
  pack,
  active,
  onSelect,
}: {
  pack: VizSummary;
  active: boolean;
  onSelect: () => void;
}) {
  const openDetail = useOpenAppearancePackDetail();
  const packRef = { kind: "visualizer" as const, id: pack.id };

  return (
    <AppearancePackCard
      active={active}
      name={pack.name}
      author={pack.author}
      description={pack.description}
      ariaLabel={`${pack.name} by ${pack.author}`}
      preview={<VizCardPreview pack={pack} />}
      previewClassName="visualizer-picker__preview"
      onApply={onSelect}
      onViewDetails={() => openDetail(packRef)}
    />
  );
}

export function VisualizersSection() {
  const packs = useVisualizerStore((s) => s.packs);
  const activePackId = useVisualizerStore((s) => s.activePackId);
  const setActivePack = useVisualizerStore((s) => s.setActivePack);
  const openVisualizersFolder = useVisualizerStore((s) => s.openVisualizersFolder);

  return (
    <div className="appearance-section">
      <div className="appearance-section__body">
        {packs.length === 0 ? (
          <p className="appearance-section__status">Loading visualizers…</p>
        ) : (
          <div className="appearance-pack-grid" role="list">
            {packs.map((pack) => (
              <div key={pack.id} role="listitem">
                <VizCard
                  pack={pack}
                  active={pack.id === activePackId}
                  onSelect={() => void setActivePack(pack.id)}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      <footer className="appearance-section__footer">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void openVisualizersFolder()}
        >
          Open visualizers folder
        </Button>
      </footer>
    </div>
  );
}
