import { getIntlLocale } from "@/lib/i18n/appLocale";
import { t } from "@/lib/i18n/i18n";

/** Scores below this read as "<0.1" rather than a misleading 0.0. */
const MIN_DISPLAYED_SCORE = 0.1;

function formatScore(score: number): string {
  const format = new Intl.NumberFormat(getIntlLocale(), {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  return score < MIN_DISPLAYED_SCORE
    ? `<${format.format(MIN_DISPLAYED_SCORE)}`
    : format.format(score);
}

export interface PopularityDescription {
  /** The score, or that the track hasn't been played. Doubles as the accessible name. */
  summary: string;
  /** One line saying the stat comes only from the user's own listening. */
  explainer: string;
}

/** The words describing a track's popularity, split so each can go where it fits best. */
export function popularityDescription(score: number): PopularityDescription {
  return {
    summary:
      score > 0
        ? t("library:popularity.score", { score: formatScore(score) })
        : t("library:popularity.none"),
    explainer: t("library:popularity.explainer"),
  };
}
