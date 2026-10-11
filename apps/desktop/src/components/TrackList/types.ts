import { t } from "../../lib/i18n";

export type TrackListColumnId =
  | "check"
  | "index"
  | "trackNumber"
  | "title"
  | "artist"
  | "album"
  | "albumArtist"
  | "duration"
  | "year"
  | "genre"
  | "discNumber"
  | "dateAdded"
  | "playCount"
  | "lastPlayedAt"
  | "rating"
  | "codec"
  | "sampleRate"
  | "bitrate"
  | "lyrics";

export type TrackListSortField = Extract<
  TrackListColumnId,
  | "title"
  | "artist"
  | "album"
  | "trackNumber"
  | "duration"
  | "year"
  | "genre"
  | "dateAdded"
  | "playCount"
  | "lastPlayedAt"
  | "rating"
  | "codec"
  | "sampleRate"
  | "bitrate"
  | "lyrics"
>;

export type TrackListSortDir = "asc" | "desc";

export type TrackListPresetId = "library" | "album" | "playlist" | "cd";

export interface TrackListColumnDef {
  id: TrackListColumnId;
  label: string;
  sortable?: boolean;
  resizable?: boolean;
  hideable?: boolean;
  align?: "left" | "center" | "right";
  secondary?: boolean;
}

export interface TrackListPreset {
  id: TrackListPresetId;
  columns: TrackListColumnDef[];
  indexColumn: "index" | "trackNumber";
}

export const CHECK_COL: TrackListColumnDef = {
  id: "check",
  label: "",
  align: "center",
};

const INDEX_COL: TrackListColumnDef = {
  id: "index",
  label: t("library:columns.index"),
  resizable: true,
  align: "center",
};

const TRACK_NUM_COL: TrackListColumnDef = {
  id: "trackNumber",
  label: t("library:columns.index"),
  resizable: true,
  align: "center",
};

const TITLE_COL: TrackListColumnDef = {
  id: "title",
  label: t("library:columns.title"),
  sortable: true,
  resizable: true,
};

const ARTIST_COL: TrackListColumnDef = {
  id: "artist",
  label: t("library:columns.artist"),
  sortable: true,
  resizable: true,
  hideable: true,
  secondary: true,
};

const ALBUM_COL: TrackListColumnDef = {
  id: "album",
  label: t("library:columns.album"),
  sortable: true,
  resizable: true,
  hideable: true,
  secondary: true,
};

const ALBUM_ARTIST_COL: TrackListColumnDef = {
  id: "albumArtist",
  label: t("library:columns.albumArtist"),
  sortable: false,
  resizable: true,
  hideable: true,
  secondary: true,
};

const DURATION_COL: TrackListColumnDef = {
  id: "duration",
  label: t("library:columns.duration"),
  sortable: true,
  resizable: true,
  align: "right",
};

const YEAR_COL: TrackListColumnDef = {
  id: "year",
  label: t("library:columns.year"),
  sortable: true,
  resizable: true,
  hideable: true,
  align: "right",
  secondary: true,
};

const GENRE_COL: TrackListColumnDef = {
  id: "genre",
  label: t("library:columns.genre"),
  sortable: true,
  resizable: true,
  hideable: true,
  secondary: true,
};

const DISC_COL: TrackListColumnDef = {
  id: "discNumber",
  label: t("library:columns.disc"),
  resizable: true,
  hideable: true,
  align: "center",
  secondary: true,
};

const TRACK_NUMBER_DATA_COL: TrackListColumnDef = {
  id: "trackNumber",
  label: t("library:columns.track"),
  sortable: true,
  resizable: true,
  hideable: true,
  align: "center",
  secondary: true,
};

const DATE_ADDED_COL: TrackListColumnDef = {
  id: "dateAdded",
  label: t("library:columns.dateAdded"),
  sortable: true,
  resizable: true,
  hideable: true,
  secondary: true,
};

const PLAY_COUNT_COL: TrackListColumnDef = {
  id: "playCount",
  label: t("library:columns.plays"),
  sortable: true,
  resizable: true,
  hideable: true,
  align: "right",
  secondary: true,
};

const LAST_PLAYED_COL: TrackListColumnDef = {
  id: "lastPlayedAt",
  label: t("library:columns.lastPlayed"),
  sortable: true,
  resizable: true,
  hideable: true,
  secondary: true,
};

const RATING_COL: TrackListColumnDef = {
  id: "rating",
  label: t("library:columns.rating"),
  sortable: true,
  resizable: true,
  hideable: true,
  align: "center",
  secondary: true,
};

const CODEC_COL: TrackListColumnDef = {
  id: "codec",
  label: t("library:columns.codec"),
  sortable: true,
  resizable: true,
  hideable: true,
  secondary: true,
};

const SAMPLE_RATE_COL: TrackListColumnDef = {
  id: "sampleRate",
  label: t("library:columns.sampleRate"),
  sortable: true,
  resizable: true,
  hideable: true,
  align: "right",
  secondary: true,
};

const BITRATE_COL: TrackListColumnDef = {
  id: "bitrate",
  label: t("library:columns.bitrate"),
  sortable: true,
  resizable: true,
  hideable: true,
  align: "right",
  secondary: true,
};

const LYRICS_COL: TrackListColumnDef = {
  id: "lyrics",
  label: t("library:columns.lyrics"),
  sortable: true,
  resizable: true,
  hideable: true,
  align: "center",
  secondary: true,
};

const LIBRARY_COLUMNS: TrackListColumnDef[] = [
  INDEX_COL,
  TITLE_COL,
  ARTIST_COL,
  ALBUM_COL,
  ALBUM_ARTIST_COL,
  YEAR_COL,
  GENRE_COL,
  DISC_COL,
  TRACK_NUMBER_DATA_COL,
  DATE_ADDED_COL,
  PLAY_COUNT_COL,
  LAST_PLAYED_COL,
  RATING_COL,
  CODEC_COL,
  SAMPLE_RATE_COL,
  BITRATE_COL,
  LYRICS_COL,
  DURATION_COL,
];

const ALBUM_COLUMNS: TrackListColumnDef[] = [
  TRACK_NUM_COL,
  ...LIBRARY_COLUMNS.filter(
    (col) =>
      col.id !== "index" && col.id !== "album" && col.id !== "trackNumber",
  ),
];

export const TRACK_LIST_PRESETS: Record<TrackListPresetId, TrackListPreset> = {
  library: {
    id: "library",
    indexColumn: "index",
    columns: LIBRARY_COLUMNS,
  },
  album: {
    id: "album",
    indexColumn: "trackNumber",
    columns: ALBUM_COLUMNS,
  },
  playlist: {
    id: "playlist",
    indexColumn: "index",
    columns: LIBRARY_COLUMNS,
  },
  cd: {
    id: "cd",
    indexColumn: "trackNumber",
    columns: [TRACK_NUM_COL, TITLE_COL, ARTIST_COL, DURATION_COL],
  },
};

export const DEFAULT_COLUMN_WIDTHS: Partial<Record<TrackListColumnId, number>> =
  {
    check: 36,
    index: 40,
    trackNumber: 64,
    title: 300,
    artist: 140,
    album: 160,
    albumArtist: 140,
    duration: 72,
    year: 56,
    genre: 120,
    discNumber: 44,
    dateAdded: 128,
    playCount: 56,
    lastPlayedAt: 128,
    rating: 120,
    codec: 72,
    sampleRate: 88,
    bitrate: 72,
    lyrics: 64,
  };

export const MIN_COLUMN_WIDTHS: Partial<Record<TrackListColumnId, number>> = {
  index: 32,
  trackNumber: 48,
  title: 140,
  artist: 72,
  album: 72,
  albumArtist: 72,
  duration: 64,
  year: 44,
  genre: 56,
  discNumber: 36,
  dateAdded: 96,
  playCount: 44,
  lastPlayedAt: 96,
  rating: 96,
  codec: 56,
  sampleRate: 72,
  bitrate: 64,
  lyrics: 56,
};

const LIBRARY_DEFAULT_HIDDEN: TrackListColumnId[] = [
  "albumArtist",
  "year",
  "genre",
  "discNumber",
  "trackNumber",
  "dateAdded",
  "playCount",
  "lastPlayedAt",
  "rating",
  "codec",
  "sampleRate",
  "bitrate",
  "lyrics",
];

const PLAYLIST_DEFAULT_HIDDEN: TrackListColumnId[] = [
  "album",
  ...LIBRARY_DEFAULT_HIDDEN,
];

const ALBUM_DEFAULT_HIDDEN: TrackListColumnId[] = LIBRARY_DEFAULT_HIDDEN.filter(
  (id) => id !== "trackNumber",
);

export function defaultHiddenColumns(
  presetId: TrackListPresetId,
): TrackListColumnId[] {
  if (presetId === "library") return [...LIBRARY_DEFAULT_HIDDEN];
  if (presetId === "playlist") return [...PLAYLIST_DEFAULT_HIDDEN];
  if (presetId === "album") return [...ALBUM_DEFAULT_HIDDEN];
  return [];
}
