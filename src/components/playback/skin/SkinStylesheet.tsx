import { useEffect } from "react";
import { scopeSkinStylesheet } from "../../../lib/scopeSkinStylesheet";
import { skinStylesheetUrl } from "../../../lib/skinStylesheet";
import { useSkinStore } from "../../../store/useSkinStore";
import type { LoadedSkinPack } from "../../../types/skin";

export function SkinStylesheet({ pack }: { pack: LoadedSkinPack }) {
  const href = skinStylesheetUrl(pack);
  const skinId = pack.summary.id;
  const packReloadGeneration = useSkinStore((s) => s.packReloadGeneration);

  useEffect(() => {
    if (!href) return;

    let cancelled = false;
    const style = document.createElement("style");
    style.dataset.skinStylesheet = skinId;

    void (async () => {
      try {
        const response = await fetch(`${href}?v=${packReloadGeneration}`);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const css = await response.text();
        if (cancelled) return;
        style.textContent = scopeSkinStylesheet(css, skinId);
        document.head.appendChild(style);
      } catch (err) {
        console.error(`Failed to load skin stylesheet for ${skinId}:`, err);
      }
    })();

    return () => {
      cancelled = true;
      style.remove();
    };
  }, [href, skinId, packReloadGeneration]);

  return null;
}
