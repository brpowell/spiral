import { skinPreviewUrl } from "../../lib/skinAssets";
import { useSkinStore } from "../../store/useSkinStore";
import type { SkinSummary } from "../../types/skin";
import { AppearancePackCard } from "./AppearancePackCard";
import { useOpenAppearancePackDetail } from "./AppearancePackDetailContext";
import "./SkinsGrid.css";

function SkinCardPreview({ skin }: { skin: SkinSummary }) {
  const preview = skinPreviewUrl(skin.previewPath);

  if (preview) {
    return <img src={preview} alt="" className="skin-picker__preview-img" />;
  }

  return <span className="skin-picker__preview-fallback" />;
}

function SkinCard({
  skin,
  active,
  onSelect,
}: {
  skin: SkinSummary;
  active: boolean;
  onSelect: () => void;
}) {
  const openDetail = useOpenAppearancePackDetail();
  const packRef = { kind: "skin" as const, id: skin.id };

  return (
    <AppearancePackCard
      active={active}
      name={skin.name}
      author={skin.author}
      description={skin.description}
      ariaLabel={`${skin.name} by ${skin.author}`}
      preview={<SkinCardPreview skin={skin} />}
      className="skin-picker__card-wrap"
      previewClassName="skin-picker__preview"
      onApply={onSelect}
      onViewDetails={() => openDetail(packRef)}
    />
  );
}

export function SkinsGrid() {
  const skins = useSkinStore((s) => s.skins);
  const activeSkinId = useSkinStore((s) => s.activeSkinId);
  const setSkin = useSkinStore((s) => s.setSkin);
  const skinsLoaded = useSkinStore((s) => s.skinsLoaded);

  return (
    <div>
      {!skinsLoaded ? (
        <p className="appearance-section__status">Loading skins…</p>
      ) : skins.length === 0 ? (
        <p className="appearance-section__status">No skins found.</p>
      ) : (
        <div className="appearance-pack-grid" role="list">
          {skins.map((skin) => (
            <div key={skin.id} role="listitem" className="skin-picker__item">
              <SkinCard
                skin={skin}
                active={skin.id === activeSkinId}
                onSelect={() => void setSkin(skin.id)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
