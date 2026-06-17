import type { ReactNode } from "react";
import type { AppearanceSection } from "../../lib/appearanceWindow";
import { IconPalette, IconSkinMode, IconVisualizer } from "../icons";

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
];

export function getAppearanceSectionConfig(
  section: AppearanceSection,
): AppearanceSectionConfig {
  return (
    APPEARANCE_SECTIONS.find((item) => item.id === section) ??
    APPEARANCE_SECTIONS[0]!
  );
}
