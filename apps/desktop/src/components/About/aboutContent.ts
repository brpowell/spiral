export type AboutTabId = "credits" | "licenses";

export interface CreditEntry {
  id: string;
  roleKey:
    | "credits.entries.musicbrainz.role"
    | "credits.entries.coverArtArchive.role"
    | "credits.entries.wikimediaCommons.role"
    | "credits.entries.wikidata.role"
    | "credits.entries.lrclib.role";
  nameKey:
    | "credits.entries.musicbrainz.name"
    | "credits.entries.coverArtArchive.name"
    | "credits.entries.wikimediaCommons.name"
    | "credits.entries.wikidata.name"
    | "credits.entries.lrclib.name";
  url: string;
}

export const CREDIT_ENTRIES: CreditEntry[] = [
  {
    id: "musicbrainz",
    roleKey: "credits.entries.musicbrainz.role",
    nameKey: "credits.entries.musicbrainz.name",
    url: "https://musicbrainz.org",
  },
  {
    id: "cover-art-archive",
    roleKey: "credits.entries.coverArtArchive.role",
    nameKey: "credits.entries.coverArtArchive.name",
    url: "https://coverartarchive.org",
  },
  {
    id: "wikimedia-commons",
    roleKey: "credits.entries.wikimediaCommons.role",
    nameKey: "credits.entries.wikimediaCommons.name",
    url: "https://commons.wikimedia.org",
  },
  {
    id: "wikidata",
    roleKey: "credits.entries.wikidata.role",
    nameKey: "credits.entries.wikidata.name",
    url: "https://www.wikidata.org",
  },
  {
    id: "lrclib",
    roleKey: "credits.entries.lrclib.role",
    nameKey: "credits.entries.lrclib.name",
    url: "https://lrclib.net",
  },
];

export const SPIRAL_WEBSITE_URL = "https://spiralpowered.com";
