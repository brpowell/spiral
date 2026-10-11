export type { IconComponent, IconTag, SpiralIconDefinition } from "./types";
export { DEFAULT_LIBRARY_ICON_ID } from "./types";
export {
  SPIRAL_ICONS,
  listLibraryIcons,
  getLibraryIcon,
  resolveIcon,
  resolveIconId,
  libraryIconHasTag,
  searchLibraryIcons,
  iconsWithTag,
  sortLibraryIconsByTag,
  humanizeIconId,
} from "./registry";
export { SpiralIcon } from "./SpiralIcon";
export type { SpiralIconProps } from "./SpiralIcon";
