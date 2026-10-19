import { useTranslation } from "react-i18next";
import { skinPreviewUrl } from "../../lib/skinAssets";
import { useSkinStore } from "../../store/useSkinStore";
import type { SkinSummary } from "../../types/skin";
import { ItemActionsMenu } from "./ItemActionsMenu";
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
  onOpenItem,
}: {
  skin: SkinSummary;
  active: boolean;
  onSelect: () => void;
  onOpenItem: (effectiveId: string) => void;
}) {
  const { t } = useTranslation("studio");
  return (
    <AppearancePackCard
      active={active}
      name={skin.name}
      author={skin.author}
      description={skin.description}
      ariaLabel={t("items.cardAria", { name: skin.name, author: skin.author })}
      preview={<SkinCardPreview skin={skin} />}
      className="skin-picker__card-wrap"
      previewClassName="skin-picker__preview"
      actions={
        <ItemActionsMenu
          item={{
            effectiveId: skin.id,
            type: "skin",
            name: skin.name,
            zone: skin.zone,
          }}
          onOpenItem={onOpenItem}
        />
      }
      onApply={onSelect}
    />
  );
}

export function SkinsGrid({
  onOpenItem,
}: {
  onOpenItem: (effectiveId: string) => void;
}) {
  const { t } = useTranslation("studio");
  const skins = useSkinStore((s) => s.skins);
  const activeSkinId = useSkinStore((s) => s.activeSkinId);
  const setSkin = useSkinStore((s) => s.setSkin);
  const skinsLoaded = useSkinStore((s) => s.skinsLoaded);

  if (!skinsLoaded) {
    return <p className="browse-view__empty">{t("skins.loading")}</p>;
  }

  if (skins.length === 0) {
    return <p className="browse-view__empty">{t("skins.empty")}</p>;
  }

  return (
    <div className="appearance-pack-grid" role="list">
      {skins.map((skin) => (
        <div key={skin.id} role="listitem" className="skin-picker__item">
          <SkinCard
            skin={skin}
            active={skin.id === activeSkinId}
            onSelect={() => void setSkin(skin.id)}
            onOpenItem={onOpenItem}
          />
        </div>
      ))}
    </div>
  );
}
