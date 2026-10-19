import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { setItemHiddenWithRefresh } from "../../lib/items/itemActions";
import { listItems } from "../../lib/tauri";
import { useItemsVersionStore } from "../../store/useItemsVersionStore";
import type { ItemSummary, ItemType } from "../../types/item";
import { Button } from "../common/Button/Button";
import "./HiddenItems.css";

/** Items of one type the user hid from pickers, with a way to show them again. */
export function HiddenItems({ type }: { type: ItemType }) {
  const { t } = useTranslation(["studio", "common"]);
  const refreshKey = useItemsVersionStore((s) => s.version);
  const [hidden, setHidden] = useState<ItemSummary[]>([]);

  useEffect(() => {
    let cancelled = false;
    void listItems()
      .then((items) => {
        if (cancelled) return;
        const seen = new Set<string>();
        setHidden(
          items.filter((i) => {
            if (i.type !== type || !i.hidden || seen.has(i.effectiveId)) {
              return false;
            }
            seen.add(i.effectiveId);
            return true;
          }),
        );
      })
      .catch(() => {
        if (!cancelled) setHidden([]);
      });
    return () => {
      cancelled = true;
    };
  }, [type, refreshKey]);

  if (hidden.length === 0) return null;

  return (
    <section className="hidden-items" aria-label={t("items.hiddenAria")}>
      <h3 className="hidden-items__title">
        {t("items.hiddenCount", { count: hidden.length })}
      </h3>
      <ul className="hidden-items__list">
        {hidden.map((item) => (
          <li key={item.effectiveId} className="hidden-items__row">
            <span className="hidden-items__name">{item.name}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                void setItemHiddenWithRefresh(item.effectiveId, false)
              }
            >
              {t("items.show")}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
