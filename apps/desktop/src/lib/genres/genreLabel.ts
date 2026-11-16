/** Width a genre label may use on a square cover, as a percentage of its width. */
const LABEL_WIDTH = 70;
/** Rough width of one bold mixed-case letter, in ems. */
const LETTER_EM = 0.64;

/**
 * Font size for the name on a genre cover, in percent of the cover's width
 * (the label scales with the cover). Sized so the longest unbreakable piece of
 * the name fits the label width, so short names are big and long ones shrink.
 */
export function genreLabelSize(name: string): number {
  const pieces = name.split(/\s+/).flatMap((word) => word.split("-"));
  const longest = Math.max(1, ...pieces.map((piece) => piece.length));
  const size = LABEL_WIDTH / (longest * LETTER_EM);
  return Math.round(Math.min(11, Math.max(7, size)) * 10) / 10;
}
