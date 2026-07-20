import { useLayoutEffect } from "react";
import {
  getCachedScopedSkinStylesheet,
  preloadSkinStylesheet,
} from "../../../lib/skinStylesheetCache";
import { skinStylesheetUrl } from "../../../lib/skinStylesheet";
import { useSkinStore } from "../../../store/useSkinStore";
import type { LoadedSkinPack } from "../../../types/skin";

export function SkinStylesheet({ pack }: { pack: LoadedSkinPack }) {
  const href = skinStylesheetUrl(pack);
  const skinId = pack.summary.id;
  const packReloadGeneration = useSkinStore((s) => s.packReloadGeneration);

  useLayoutEffect(() => {
    if (!href) return;

    let cancelled = false;
    const style = document.createElement("style");
    style.dataset.skinStylesheet = skinId;

    const inject = (css: string) => {
      style.textContent = css;
      document.head.appendChild(style);
    };

    const cached = getCachedScopedSkinStylesheet(skinId, packReloadGeneration);
    if (cached) {
      inject(cached);
      return () => {
        style.remove();
      };
    }

    void (async () => {
      await preloadSkinStylesheet(pack, packReloadGeneration);
      if (cancelled) return;
      const scoped = getCachedScopedSkinStylesheet(skinId, packReloadGeneration);
      if (!scoped) return;
      inject(scoped);
    })();

    return () => {
      cancelled = true;
      style.remove();
    };
  }, [href, skinId, pack, packReloadGeneration]);

  return null;
}
