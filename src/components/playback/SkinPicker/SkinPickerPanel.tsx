import { skinPreviewUrl } from "../../../lib/skinAssets";
import { useSkinStore } from "../../../store/useSkinStore";
import { IconCheck } from "../../icons";
import type { SkinSummary } from "../../../types/skin";
import "./SkinPicker.css";

function SkinCard({
  skin,
  active,
  onSelect,
}: {
  skin: SkinSummary;
  active: boolean;
  onSelect: () => void;
}) {
  const preview = skinPreviewUrl(skin.previewPath);

  return (
    <button
      type="button"
      className={
        active
          ? "skin-picker__card skin-picker__card--active"
          : "skin-picker__card"
      }
      aria-pressed={active}
      aria-label={`${skin.name} by ${skin.author}`}
      onClick={onSelect}
    >
      <div className="skin-picker__preview" aria-hidden>
        {preview ? (
          <img src={preview} alt="" className="skin-picker__preview-img" />
        ) : (
          <span className="skin-picker__preview-fallback" />
        )}
        {active && (
          <span className="skin-picker__check" aria-hidden>
            <IconCheck />
          </span>
        )}
      </div>
      <div className="skin-picker__meta">
        <span className="skin-picker__name">{skin.name}</span>
        <span className="skin-picker__author">{skin.author}</span>
        <span className="skin-picker__description">
          {skin.description ?? ""}
        </span>
      </div>
    </button>
  );
}

export function SkinPickerPanel() {
  const skins = useSkinStore((s) => s.skins);
  const activeSkinId = useSkinStore((s) => s.activeSkinId);
  const setSkin = useSkinStore((s) => s.setSkin);
  const skinsLoaded = useSkinStore((s) => s.skinsLoaded);

  return (
    <div className="skin-picker-panel">
      {!skinsLoaded ? (
        <p className="skin-picker-panel__status">Loading skins…</p>
      ) : skins.length === 0 ? (
        <p className="skin-picker-panel__status">No skins found.</p>
      ) : (
        <div className="skin-picker__grid" role="list">
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
