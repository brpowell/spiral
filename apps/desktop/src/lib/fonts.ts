/**
 * The closed set of fonts a theme can pick. A theme's `font-ui` token holds one
 * of these ids, never a CSS stack, and `resolveFontStack` expands it on apply.
 *
 * `bundled` fonts ship with the app (see `styles/fonts.css`); `system` fonts are
 * stacks of faces that are standard on macOS, Windows and Linux. Mirrors
 * `THEME_FONT_IDS` in `libs/spk-format/src/theme.rs`; a test keeps the two in step.
 */
export type FontGroup = "bundled" | "system";

export type ThemeFont = {
  id: string;
  label: string;
  group: FontGroup;
  stack: string;
};

const SANS_FALLBACK = "system-ui, -apple-system, sans-serif";

export const THEME_FONTS: readonly ThemeFont[] = [
  {
    id: "inter",
    label: "Inter",
    group: "bundled",
    stack: `"Inter", ${SANS_FALLBACK}`,
  },
  {
    id: "rubik",
    label: "Rubik",
    group: "bundled",
    stack: `"Rubik", ${SANS_FALLBACK}`,
  },
  {
    id: "outfit",
    label: "Outfit",
    group: "bundled",
    stack: `"Outfit", ${SANS_FALLBACK}`,
  },
  {
    id: "m-plus-rounded-1c",
    label: "M PLUS Rounded 1c",
    group: "bundled",
    stack: `"M PLUS Rounded 1c", ${SANS_FALLBACK}`,
  },
  {
    id: "system-ui",
    label: "System UI",
    group: "system",
    stack: `system-ui, -apple-system, "Segoe UI", sans-serif`,
  },
  {
    id: "helvetica",
    label: "Helvetica / Arial",
    group: "system",
    stack: `"Helvetica Neue", Helvetica, Arial, sans-serif`,
  },
  {
    id: "verdana",
    label: "Verdana",
    group: "system",
    stack: "Verdana, Geneva, sans-serif",
  },
  {
    id: "trebuchet",
    label: "Trebuchet MS",
    group: "system",
    stack: `"Trebuchet MS", "Lucida Grande", sans-serif`,
  },
  {
    id: "georgia",
    label: "Georgia",
    group: "system",
    stack: `Georgia, "Times New Roman", Times, serif`,
  },
  {
    id: "palatino",
    label: "Palatino",
    group: "system",
    stack: `Palatino, "Palatino Linotype", "Book Antiqua", serif`,
  },
  {
    id: "monospace",
    label: "Monospace",
    group: "system",
    stack: `ui-monospace, SFMono-Regular, Menlo, Consolas, "Courier New", monospace`,
  },
];

export const DEFAULT_FONT_ID = "inter";

export function findThemeFont(id: string | undefined): ThemeFont | undefined {
  return THEME_FONTS.find((font) => font.id === id);
}

/** CSS stack for a font id; an unknown id falls back to the default font. */
export function resolveFontStack(id: string | undefined): string {
  return (findThemeFont(id) ?? findThemeFont(DEFAULT_FONT_ID)!).stack;
}
