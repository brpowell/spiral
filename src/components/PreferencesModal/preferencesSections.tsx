import type { ReactNode } from "react";
import {
  IconAudioWaveform,
  IconDisc,
  IconGlasses,
  IconInfo,
  IconOpenFolder,
} from "../icons";

export type PreferencesSectionId =
  | "library"
  | "cd"
  | "playback"
  | "listening"
  | "metadata";

export interface PreferencesSectionConfig {
  id: PreferencesSectionId;
  label: string;
  icon: ReactNode;
}

export const PREFERENCES_SECTIONS: PreferencesSectionConfig[] = [
  {
    id: "library",
    label: "Library",
    icon: <IconOpenFolder />,
  },
  {
    id: "cd",
    label: "CD",
    icon: <IconDisc />,
  },
  {
    id: "playback",
    label: "Playback",
    icon: <IconAudioWaveform />,
  },
  {
    id: "listening",
    label: "Privacy",
    icon: <IconGlasses />,
  },
  {
    id: "metadata",
    label: "Metadata",
    icon: <IconInfo />,
  },
];
