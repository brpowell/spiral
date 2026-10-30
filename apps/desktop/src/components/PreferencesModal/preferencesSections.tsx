import type { ReactNode } from "react";
import { t } from "../../lib/i18n";
import {
  IconAudioWaveform,
  IconDisc,
  IconFolderLink,
  IconGlasses,
  IconInfo,
  IconOpenFolder,
  IconPalette,
  IconRefresh,
} from "../icons";

export type PreferencesSectionId =
  | "library"
  | "sources"
  | "cd"
  | "playback"
  | "listening"
  | "metadata"
  | "studio"
  | "updates";

export interface PreferencesSectionConfig {
  id: PreferencesSectionId;
  label: string;
  icon: ReactNode;
}

export const PREFERENCES_SECTIONS: PreferencesSectionConfig[] = [
  {
    id: "library",
    label: t("preferences:sections.library"),
    icon: <IconOpenFolder />,
  },
  {
    id: "sources",
    label: t("preferences:sections.sources"),
    icon: <IconFolderLink />,
  },
  {
    id: "cd",
    label: t("preferences:sections.cd"),
    icon: <IconDisc />,
  },
  {
    id: "playback",
    label: t("preferences:sections.playback"),
    icon: <IconAudioWaveform />,
  },
  {
    id: "listening",
    label: t("preferences:sections.listening"),
    icon: <IconGlasses />,
  },
  {
    id: "metadata",
    label: t("preferences:sections.metadata"),
    icon: <IconInfo />,
  },
  {
    id: "studio",
    label: t("preferences:sections.studio"),
    icon: <IconPalette />,
  },
  {
    id: "updates",
    label: t("preferences:sections.updates"),
    icon: <IconRefresh />,
  },
];
