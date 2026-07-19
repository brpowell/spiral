import type { ReactNode } from "react";
import type { AppearanceSection } from "../../lib/appearanceWindow";
import {
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

export const APPEARANCE_SECTIONS: AppearanceSectionConfig[] = [
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

export const APPEARANCE_CONTENT_SECTIONS: AppearanceSectionConfig[] =
  APPEARANCE_SECTIONS.filter((item) => item.id !== "packs");

export const APPEARANCE_MANAGE_SECTION = APPEARANCE_SECTIONS.find(
  (item) => item.id === "packs",
)!;

export function getAppearanceSectionConfig(
  section: AppearanceSection,
): AppearanceSectionConfig {
  return (
    APPEARANCE_SECTIONS.find((item) => item.id === section) ??
    APPEARANCE_SECTIONS[0]!
  );
}
