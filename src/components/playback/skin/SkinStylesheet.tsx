import { useEffect } from "react";
import { skinStylesheetUrl } from "../../../lib/skinStylesheet";
import { useSkinStore } from "../../../store/useSkinStore";
import type { LoadedSkinPack } from "../../../types/skin";

export function SkinStylesheet({ pack }: { pack: LoadedSkinPack }) {
  const href = skinStylesheetUrl(pack);
  const skinId = pack.summary.id;
  const packReloadGeneration = useSkinStore((s) => s.packReloadGeneration);

  useEffect(() => {
    if (!href) return;

    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `${href}?v=${packReloadGeneration}`;
    link.dataset.skinStylesheet = skinId;
    document.head.appendChild(link);

    return () => {
      link.remove();
    };
  }, [href, skinId, packReloadGeneration]);

  return null;
}
