import type { SkinCondition, WhenMapOrList } from "../types/skin";

export function iterWhenOverlays<T extends object>(
  when: WhenMapOrList<T> | undefined,
): Array<{ when: SkinCondition; overlay: T }> {
  if (!when) return [];
  if (Array.isArray(when)) {
    return when.map(({ when: condition, ...overlay }) => ({
      when: condition,
      overlay: overlay as T,
    }));
  }
  return Object.entries(when).map(([condition, overlay]) => ({
    when: condition,
    overlay,
  }));
}
