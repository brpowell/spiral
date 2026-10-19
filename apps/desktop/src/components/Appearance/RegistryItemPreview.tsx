import { useState } from "react";
import type { ItemType } from "../../types/item";
import { itemTypeMeta } from "./itemShared";

/** Catalog preview (Rust-cached `asset:` URL), falling back to the item type's icon. */
export function RegistryItemPreview({
  src,
  itemType,
  className,
}: {
  src?: string | null;
  itemType: ItemType;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(src) && !failed;

  return (
    <div
      className={["registry-browse__preview", className]
        .filter(Boolean)
        .join(" ")}
      aria-hidden
    >
      {showImage ? (
        <img
          className="registry-browse__preview-img"
          src={src!}
          alt=""
          onError={() => setFailed(true)}
        />
      ) : (
        itemTypeMeta(itemType).icon
      )}
    </div>
  );
}
