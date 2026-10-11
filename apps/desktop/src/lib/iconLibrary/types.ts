import type { ComponentType, SVGProps } from "react";

export type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

/** Freeform keywords for search / filtering (e.g. music, playback, window). */
export type IconTag = string;

export type SpiralIconDefinition = {
  /** Stable library id — same space skins use (`setList`, `headphones`). */
  id: string;
  component: IconComponent;
  tags: readonly IconTag[];
};

export const DEFAULT_LIBRARY_ICON_ID = "note";
