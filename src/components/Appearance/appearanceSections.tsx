import type { ReactNode } from "react";
import type { AppearanceSection } from "../../lib/appearanceWindow";
import {
  IconDownload,
  IconPackage,
  IconPalette,
  IconSkinMode,
  IconVisualizer,
} from "../icons";

export interface AppearanceSectionConfig {
  id: AppearanceSection;
  label: string;
  icon: ReactNode;
}

/** Themes → Visualizers → Skins → Packs (single content rail). */
export const APPEARANCE_CONTENT_SECTIONS: AppearanceSectionConfig[] = [
  {
    id: "themes",
    label: "Themes",
    icon: <IconPalette />,
  },
  {
    id: "visualizers",
    label: "Visualizers",
    icon: <IconVisualizer />,
  },
  {
    id: "skins",
    label: "Skins",
    icon: <IconSkinMode />,
  },
  {
    id: "packs",
    label: "Packs",
    icon: <IconPackage />,
  },
];

/** Catalog browse — own sidebar section below the separator. */
export const APPEARANCE_CATALOG_SECTION: AppearanceSectionConfig = {
  id: "catalog",
  label: "Get more…",
  icon: <IconDownload />,
};

export const APPEARANCE_SECTIONS: AppearanceSectionConfig[] = [
  ...APPEARANCE_CONTENT_SECTIONS,
  APPEARANCE_CATALOG_SECTION,
];

export function getAppearanceSectionConfig(
  section: AppearanceSection,
): AppearanceSectionConfig {
  return (
    APPEARANCE_SECTIONS.find((item) => item.id === section) ??
    APPEARANCE_SECTIONS[0]!
  );
}
