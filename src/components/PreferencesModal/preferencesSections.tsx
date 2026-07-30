import type { ReactNode } from "react";
import { t } from "../../lib/i18n";
import {
  IconAudioWaveform,
  IconDisc,
  IconGlasses,
  IconInfo,
  IconOpenFolder,
  IconPalette,
} from "../icons";

export type PreferencesSectionId =
  | "library"
  | "cd"
  | "playback"
  | "listening"
  | "metadata"
  | "studio";

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
];
