import { useState, type ReactNode } from "react";
import { t } from "../../lib/i18n";
import { packPreviewUrl } from "../../lib/packs/packPreview";
import type { ItemSummary, ItemType } from "../../types/item";
import {
  IconBoombox,
  IconPackage,
  IconPalette,
  IconVisualizer,
  IconVolume,
} from "../icons";

export function itemTypeMeta(type: ItemType): {
  label: string;
  icon: ReactNode;
} {
  const label = t(`studio:items.typeNames.${type}`);
  switch (type) {
    case "theme":
      return { label, icon: <IconPalette /> };
    case "skin":
      return { label, icon: <IconBoombox /> };
    case "visualizer":
      return { label, icon: <IconVisualizer /> };
    case "sound":
      return { label, icon: <IconVolume /> };
    default:
      return { label, icon: <IconPackage /> };
  }
}

/** Item preview image from its declared `preview`, falling back to the type icon. */
export function ItemPreview({
  item,
  className,
}: {
  item: Pick<ItemSummary, "dir" | "preview" | "type">;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const src =
    item.preview && item.dir && !failed
      ? packPreviewUrl(item.dir, item.preview)
      : null;

  return (
    <div className={className} aria-hidden>
      {src ? (
        <img
          className="installed-packs__preview-img"
          src={src}
          alt=""
          onError={() => setFailed(true)}
        />
      ) : (
        itemTypeMeta(item.type).icon
      )}
    </div>
  );
}
