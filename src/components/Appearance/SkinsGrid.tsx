import { skinPreviewUrl } from "../../lib/skinAssets";
import { useSkinStore } from "../../store/useSkinStore";
import type { SkinSummary } from "../../types/skin";
import { AppearancePackActions } from "./AppearancePackActions";
import { AppearancePackCard } from "./AppearancePackCard";
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
  onOpenPack,
}: {
  skin: SkinSummary;
  active: boolean;
  onSelect: () => void;
  onOpenPack: (packId: string) => void;
}) {
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
      actions={
        skin.packId ? (
          <AppearancePackActions
            name={skin.name}
            packId={skin.packId}
            onOpenPack={onOpenPack}
          />
        ) : undefined
      }
      onApply={onSelect}
    />
  );
}

export function SkinsGrid({
  onOpenPack,
}: {
  onOpenPack: (packId: string) => void;
}) {
  const skins = useSkinStore((s) => s.skins);
  const activeSkinId = useSkinStore((s) => s.activeSkinId);
  const setSkin = useSkinStore((s) => s.setSkin);
  const skinsLoaded = useSkinStore((s) => s.skinsLoaded);

  if (!skinsLoaded) {
    return <p className="browse-view__empty">Loading skins…</p>;
  }

  if (skins.length === 0) {
    return <p className="browse-view__empty">No skins found.</p>;
  }

  return (
    <div className="appearance-pack-grid" role="list">
      {skins.map((skin) => (
        <div key={skin.id} role="listitem" className="skin-picker__item">
          <SkinCard
            skin={skin}
            active={skin.id === activeSkinId}
            onSelect={() => void setSkin(skin.id)}
            onOpenPack={onOpenPack}
          />
        </div>
      ))}
    </div>
  );
}
