import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { listItems } from "../../lib/tauri";
import { useItemsVersionStore } from "../../store/useItemsVersionStore";
import type { ItemSummary } from "../../types/item";
import { BrowseGridBody } from "../BrowseView/BrowseGridBody";
import { BrowseView } from "../BrowseView/BrowseView";
import { BrowseViewHeader } from "../BrowseView/BrowseViewHeader";
import { HiddenItems } from "./HiddenItems";
import { ItemActionsMenu } from "./ItemActionsMenu";
import { ItemsAddMenu } from "./ItemsAddMenu";
import { itemTypeMeta } from "./itemShared";
import "./AppearanceSection.css";

/**
 * Sounds are referenced by id from skins rather than picked, so this lists them
 * without an “apply” action.
 */
export function SoundsSection({
  onOpenItem,
}: {
  onOpenItem: (effectiveId: string) => void;
}) {
  const { t } = useTranslation(["studio", "library"]);
  const [sounds, setSounds] = useState<ItemSummary[] | null>(null);
  const version = useItemsVersionStore((s) => s.version);

  const load = useCallback(async () => {
    try {
      const items = await listItems();
      const seen = new Set<string>();
      setSounds(
        items.filter((i) => {
          if (i.type !== "sound" || i.hidden || !i.active) return false;
          if (seen.has(i.effectiveId)) return false;
          seen.add(i.effectiveId);
          return true;
        }),
      );
    } catch (err) {
      console.error("Failed to list sounds:", err);
      setSounds([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, version]);

  return (
    <BrowseView>
      <BrowseViewHeader
        className="browse-view__header--single-row"
        title={t("sounds.title")}
        count={
          sounds
            ? t("library:views.headerCount", { count: sounds.length })
            : undefined
        }
        actions={<ItemsAddMenu />}
      />
      <BrowseGridBody>
        {sounds == null ? (
          <p className="browse-view__empty">{t("sounds.loading")}</p>
        ) : sounds.length === 0 ? (
          <p className="browse-view__empty">{t("sounds.empty")}</p>
        ) : (
          <ul className="item-list" role="list">
            {sounds.map((sound) => (
              <li key={sound.effectiveId} className="item-list__row">
                <span className="item-list__icon" aria-hidden>
                  {itemTypeMeta("sound").icon}
                </span>
                <span className="item-list__main">
                  <span className="item-list__name">{sound.name}</span>
                  <span className="item-list__meta">
                    {sound.author.trim() || sound.authorId}
                  </span>
                </span>
                <ItemActionsMenu item={sound} onOpenItem={onOpenItem} />
              </li>
            ))}
          </ul>
        )}
        <HiddenItems type="sound" />
      </BrowseGridBody>
    </BrowseView>
  );
}
