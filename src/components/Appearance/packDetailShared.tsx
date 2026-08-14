import { useState, type ReactNode } from "react";
import { packPreviewUrl } from "../../lib/packs/packPreview";
import {
  CONTRIBUTION_TYPE_FOLDERS,
  type PackContributionSummary,
  type PackSummary,
} from "../../types/pack";
import {
  IconGpu,
  IconPackage,
  IconPalette,
  IconSkinMode,
  IconVisualizer,
} from "../icons";

export function packKey(pack: PackSummary): string {
  return `${pack.zone}:${pack.authorId}.${pack.packId}@${pack.version}:${pack.packDir}`;
}

/** Inactive installed dirs kept on disk after an update (not shown as list rows). */
export function isPreviousInstalledPack(pack: PackSummary): boolean {
  return pack.zone === "installed" && !pack.active;
}

export function contributionTypeMeta(type: string): {
  label: string;
  icon: ReactNode;
} {
  switch (type) {
    case "theme":
      return { label: "Themes", icon: <IconPalette /> };
    case "skin":
      return { label: "Skins", icon: <IconSkinMode /> };
    case "visualizer":
      return { label: "Visualizers", icon: <IconVisualizer /> };
    case "renderer":
      return { label: "Renderers", icon: <IconGpu /> };
    default:
      return { label: type, icon: <IconPackage /> };
  }
}

/** Group contributions by type in canonical folder order, then any unknown types. */
export function groupContributionsByType(
  contributions: PackContributionSummary[],
): Array<{ type: string; items: PackContributionSummary[] }> {
  const byType = new Map<string, PackContributionSummary[]>();
  for (const c of contributions) {
    const list = byType.get(c.type);
    if (list) {
      list.push(c);
    } else {
      byType.set(c.type, [c]);
    }
  }

  const groups: Array<{ type: string; items: PackContributionSummary[] }> = [];
  for (const { type } of CONTRIBUTION_TYPE_FOLDERS) {
    const items = byType.get(type);
    if (items?.length) {
      groups.push({ type, items });
      byType.delete(type);
    }
  }
  for (const [type, items] of byType) {
    groups.push({ type, items });
  }
  return groups;
}

export function PackPreview({
  pack,
  previewSrc,
  className,
}: {
  pack?: Pick<PackSummary, "packDir" | "preview"> | null;
  /** External / cached preview URL (e.g. registry catalog). */
  previewSrc?: string | null;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const fromPack =
    pack?.preview && pack.packDir && !failed
      ? packPreviewUrl(pack.packDir, pack.preview)
      : null;
  const src = previewSrc && !failed ? previewSrc : fromPack;

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
        <IconPackage />
      )}
    </div>
  );
}
