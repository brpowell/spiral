import { useState } from "react";
import { useTranslation } from "react-i18next";
import { skinPreviewUrl } from "../../lib/skinAssets";
import { useBackgroundTasksStore } from "../../store/useBackgroundTasksStore";
import { useSoundPackStore } from "../../store/useSoundPackStore";
import type { SoundPackSummary } from "../../types/soundPack";
import { BrowseGridBody } from "../BrowseView/BrowseGridBody";
import { BrowseView } from "../BrowseView/BrowseView";
import { BrowseViewHeader } from "../BrowseView/BrowseViewHeader";
import { IconVolume } from "../icons";
import { AppearancePackCard } from "./AppearancePackCard";
import { HiddenItems } from "./HiddenItems";
import { ItemActionsMenu } from "./ItemActionsMenu";
import "./AppearanceSection.css";
import "./SoundsSection.css";

function SoundPackPreview({ pack }: { pack: SoundPackSummary }) {
  const preview = skinPreviewUrl(pack.previewPath);
  return preview ? (
    <img src={preview} alt="" className="sound-picker__preview-img" />
  ) : (
    <span className="sound-picker__preview-fallback">
      <IconVolume />
    </span>
  );
}

/** Pick the active sound pack. Skins ask for cues and the active pack answers them. */
export function SoundsSection({
  onOpenItem,
}: {
  onOpenItem: (effectiveId: string) => void;
}) {
  const { t } = useTranslation(["studio", "library"]);
  const soundPacks = useSoundPackStore((s) => s.soundPacks);
  const loaded = useSoundPackStore((s) => s.soundPacksLoaded);
  const activeId = useSoundPackStore((s) => s.activeSoundPackId);
  const setActive = useSoundPackStore((s) => s.setActiveSoundPack);
  const showErrorToast = useBackgroundTasksStore((s) => s.showErrorToast);
  const [applying, setApplying] = useState(false);

  const handleSelect = async (pack: SoundPackSummary) => {
    if (applying || pack.id === activeId) return;
    setApplying(true);
    try {
      await setActive(pack.id);
    } catch (err) {
      showErrorToast({
        label: err instanceof Error ? err.message : t("sounds.applyFailed"),
        key: "sound-pack-apply",
      });
    } finally {
      setApplying(false);
    }
  };

  return (
    <BrowseView>
      <BrowseViewHeader
        className="browse-view__header--single-row"
        title={t("sounds.title")}
        count={
          loaded
            ? t("library:views.headerCount", { count: soundPacks.length })
            : undefined
        }
      />
      <BrowseGridBody>
        {!loaded ? (
          <p className="browse-view__empty">{t("sounds.loading")}</p>
        ) : soundPacks.length === 0 ? (
          <p className="browse-view__empty">{t("sounds.empty")}</p>
        ) : (
          <div className="appearance-pack-grid" role="list">
            {soundPacks.map((pack) => (
              <div key={pack.id} role="listitem">
                <AppearancePackCard
                  active={pack.id === activeId}
                  name={pack.name}
                  author={pack.author || pack.authorId}
                  description={pack.description}
                  ariaLabel={t("items.cardAria", {
                    name: pack.name,
                    author: pack.author || pack.authorId,
                  })}
                  preview={<SoundPackPreview pack={pack} />}
                  previewClassName="sound-picker__preview"
                  actions={
                    <ItemActionsMenu
                      item={{
                        effectiveId: pack.id,
                        type: "sound",
                        name: pack.name,
                        zone: pack.zone,
                      }}
                      onOpenItem={onOpenItem}
                    />
                  }
                  onApply={() => void handleSelect(pack)}
                />
              </div>
            ))}
          </div>
        )}
        <HiddenItems type="sound" />
      </BrowseGridBody>
    </BrowseView>
  );
}
