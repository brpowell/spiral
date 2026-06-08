import { useEffect } from "react";
import { skinStylesheetUrl } from "../../../lib/skinStylesheet";
import type { LoadedSkinPack } from "../../../types/skin";

export function SkinStylesheet({ pack }: { pack: LoadedSkinPack }) {
  const href = skinStylesheetUrl(pack);
  const skinId = pack.summary.id;

  useEffect(() => {
    if (!href) return;

    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.dataset.skinStylesheet = skinId;
    document.head.appendChild(link);

    return () => {
      link.remove();
    };
  }, [href, skinId]);

  return null;
}
