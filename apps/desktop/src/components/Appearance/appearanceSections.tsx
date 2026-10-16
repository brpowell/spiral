import type { ReactNode } from "react";
import type { AppearanceSection } from "../../lib/appearanceWindow";
import { REGISTRY_ENABLED } from "../../lib/featureFlags";
import { t } from "../../lib/i18n";
import {
  IconDownload,
  IconPalette,
  IconBoombox,
  IconVolume,
  IconVisualizer,
} from "../icons";

export interface AppearanceSectionConfig {
  id: AppearanceSection;
  label: string;
  icon: ReactNode;
}

/** Themes → Visualizers → Skins → Sounds (single content rail). */
export const APPEARANCE_CONTENT_SECTIONS: AppearanceSectionConfig[] = [
  {
    id: "themes",
    label: t("studio:nav.themes"),
    icon: <IconPalette />,
  },
  {
    id: "visualizers",
    label: t("studio:nav.visualizers"),
    icon: <IconVisualizer />,
  },
  {
    id: "skins",
    label: t("studio:nav.skins"),
    icon: <IconBoombox />,
  },
  {
    id: "sounds",
    label: t("studio:nav.sounds"),
    icon: <IconVolume />,
  },
];

/** Catalog browse — own sidebar section below the separator. */
export const APPEARANCE_CATALOG_SECTION: AppearanceSectionConfig = {
  id: "catalog",
  label: t("studio:catalog.sidebar"),
  icon: <IconDownload />,
};

export const APPEARANCE_SECTIONS: AppearanceSectionConfig[] = [
  ...APPEARANCE_CONTENT_SECTIONS,
  ...(REGISTRY_ENABLED ? [APPEARANCE_CATALOG_SECTION] : []),
];

export function getAppearanceSectionConfig(
  section: AppearanceSection,
): AppearanceSectionConfig {
  return (
    APPEARANCE_SECTIONS.find((item) => item.id === section) ??
    APPEARANCE_SECTIONS[0]!
  );
}
