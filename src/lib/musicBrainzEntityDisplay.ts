import { countryFlagEmoji, formatCountryDisplay } from "./countryFlag";
import { t } from "./i18n";
import type {
  MusicBrainzEntityHit,
  MusicBrainzEntityKind,
} from "../types/musicbrainz";

export function musicBrainzEntityUrl(
  kind: MusicBrainzEntityKind,
  mbid: string,
): string {
  return `https://musicbrainz.org/${kind}/${mbid}`;
}

/** Primary line for assigned cards and search rows. */
export function musicBrainzHitTitle(hit: MusicBrainzEntityHit): string {
  const disambiguation = hit.disambiguation?.trim();
  if (disambiguation) {
    return `${hit.title} (${disambiguation})`;
  }
  return hit.title;
}

export type MusicBrainzHitFact = {
  key: string;
  label: string;
  value: string;
};

function fact(
  key: string,
  label: string,
  value: string | null | undefined,
): MusicBrainzHitFact | null {
  const trimmed = value?.trim();
  return trimmed ? { key, label, value: trimmed } : null;
}

function artistFromValue(hit: MusicBrainzEntityHit): string | null {
  const area = hit.area?.trim() || null;
  if (!area) return null;
  const flag = hit.country?.trim()
    ? countryFlagEmoji(hit.country.trim())
    : null;
  return flag ? `${flag} ${area}` : area;
}

/** Labeled facts for assigned cards and search rows. Omits empty fields. */
export function musicBrainzHitFacts(
  hit: MusicBrainzEntityHit,
): MusicBrainzHitFact[] {
  if (hit.kind === "artist") {
    return [
      fact("type", t("library:editor.musicBrainz.facts.type"), hit.entityType),
      fact(
        "from",
        t("library:editor.musicBrainz.facts.from"),
        artistFromValue(hit),
      ),
    ].filter((item): item is MusicBrainzHitFact => item != null);
  }

  const facts = [
    fact(
      "year",
      t("library:editor.fields.year"),
      hit.year != null ? String(hit.year) : null,
    ),
    fact(
      "country",
      t("library:editor.musicBrainz.facts.country"),
      hit.country?.trim() ? formatCountryDisplay(hit.country.trim()) : null,
    ),
    hit.kind === "release" && hit.trackCount != null && hit.trackCount > 0
      ? {
          key: "tracks",
          label: t("library:editor.musicBrainz.facts.tracks"),
          value: String(hit.trackCount),
        }
      : null,
    fact("artist", t("library:editor.fields.artist"), hit.artist),
    fact("label", t("library:editor.musicBrainz.facts.label"), hit.label),
  ].filter((item): item is MusicBrainzHitFact => item != null);

  return facts;
}
