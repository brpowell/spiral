import type { SVGProps } from "react";
import { getLibraryIcon, resolveIconId } from "./registry";
import type { IconComponent } from "./types";

export type SpiralIconProps = SVGProps<SVGSVGElement> & {
  id: string | null | undefined;
};

/** Render a library icon by id; unknown ids fall back to the default. */
export function SpiralIcon({ id, ...props }: SpiralIconProps) {
  const resolved = resolveIconId(id);
  const def = getLibraryIcon(resolved);
  const Component: IconComponent | undefined = def?.component;
  if (!Component) return null;
  return <Component {...props} />;
}
