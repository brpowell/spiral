import type { ReactNode } from "react";
import type { AppearanceSection } from "../../lib/appearanceWindow";
import type { ItemType } from "../../types/item";
import { t } from "../../lib/i18n";
import {
  IconBrandmark,
  IconPalette,
  IconBoombox,
  IconVolume,
  IconVisualizer,
} from "../icons";

export interface AppearanceSectionConfig {
  id: AppearanceSection;
  label: string;
  icon: ReactNode;
  /** The item type this section lists, when it lists one. */
  itemType?: ItemType;
}

/** Themes → Visualizers → Skins → Sounds (single content rail). */
export const APPEARANCE_CONTENT_SECTIONS: AppearanceSectionConfig[] = [
  {
    id: "themes",
    itemType: "theme",
    label: t("studio:nav.themes"),
    icon: <IconPalette />,
  },
  {
    id: "visualizers",
    itemType: "visualizer",
    label: t("studio:nav.visualizers"),
    icon: <IconVisualizer />,
  },
  {
    id: "skins",
    itemType: "skin",
    label: t("studio:nav.skins"),
    icon: <IconBoombox />,
  },
  {
    id: "sounds",
    itemType: "sound",
    label: t("studio:nav.sounds"),
    icon: <IconVolume />,
  },
];

/** Catalog browse — the Spiral Official registry, in its own sidebar section. */
export const APPEARANCE_CATALOG_SECTION: AppearanceSectionConfig = {
  id: "catalog",
  label: t("studio:catalog.sidebar"),
  icon: <IconBrandmark />,
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
