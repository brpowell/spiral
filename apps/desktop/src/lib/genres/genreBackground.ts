/** A color the user picked for a genre, or a gradient from one to another. */
export interface ColorBackground {
  start: string;
  end: string | null;
}

/** The theme palette as a single flat color, with no gradient. */
export interface ThemeSolidBackground {
  theme: "solid";
}

/**
 * A background the user picked for a genre. A genre without one uses the theme
 * palette as a gradient.
 */
export type GenreBackground = ColorBackground | ThemeSolidBackground;

export function isThemeSolid(
  background: GenreBackground | null | undefined,
): background is ThemeSolidBackground {
  return background != null && "theme" in background;
}

export type GenreBackgrounds = Record<string, GenreBackground>;

const HEX = /^#[0-9a-f]{6}$/i;

export function genreBackgroundsEqual(
  a: GenreBackground | null | undefined,
  b: GenreBackground | null | undefined,
): boolean {
  if (!a || !b) return !a && !b;
  if (isThemeSolid(a) || isThemeSolid(b))
    return isThemeSolid(a) && isThemeSolid(b);
  return a.start === b.start && a.end === b.end;
}

/** A background as the backend stores it. */
export interface BackgroundRecord {
  kind: "color" | "themeSolid";
  start: string | null;
  end: string | null;
}

export function toBackgroundRecord(
  background: GenreBackground | null,
): BackgroundRecord | null {
  if (!background) return null;
  if (isThemeSolid(background)) {
    return { kind: "themeSolid", start: null, end: null };
  }
  return { kind: "color", start: background.start, end: background.end };
}

export function fromBackgroundRecord(
  record: BackgroundRecord | null | undefined,
): GenreBackground | null {
  if (!record) return null;
  if (record.kind === "themeSolid") return { theme: "solid" };
  return record.start && HEX.test(record.start)
    ? {
        start: record.start,
        end: record.end && HEX.test(record.end) ? record.end : null,
      }
    : null;
}

/**
 * Backgrounds after a genre key changes. The destination keeps its own
 * background when it has one (a merge); otherwise it adopts the source's.
 */
export function backgroundsAfterRename(
  backgrounds: GenreBackgrounds,
  oldKey: string,
  newKey: string,
): GenreBackgrounds {
  if (oldKey === newKey || !(oldKey in backgrounds)) return backgrounds;
  const { [oldKey]: moved, ...rest } = backgrounds;
  return newKey in rest ? rest : { ...rest, [newKey]: moved };
}

/**
 * What the editor holds while the background is being chosen: the mode, plus
 * each mode's own settings, so switching modes and back loses nothing.
 */
export interface BackgroundDraft {
  mode: "color" | "theme";
  /** The picked color(s); null until "Choose color" is first used. */
  color: ColorBackground | null;
  /** Whether the theme palette is drawn as a gradient. */
  gradient: boolean;
}

export function draftFromBackground(
  background: GenreBackground | null,
): BackgroundDraft {
  if (background && !isThemeSolid(background)) {
    return { mode: "color", color: background, gradient: true };
  }
  return { mode: "theme", color: null, gradient: !isThemeSolid(background) };
}

/** The background a draft stands for; null is the theme palette gradient. */
export function backgroundFromDraft(
  draft: BackgroundDraft,
): GenreBackground | null {
  if (draft.mode === "color" && draft.color) return draft.color;
  return draft.gradient ? null : { theme: "solid" };
}
