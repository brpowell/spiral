export type TrackListColumnId =
  | "index"
  | "trackNumber"
  | "title"
  | "artist"
  | "album"
  | "albumArtist"
  | "duration"
  | "year"
  | "genre"
  | "discNumber";

export type TrackListSortField = Extract<
  TrackListColumnId,
  "index" | "title" | "artist" | "album" | "duration" | "year" | "genre"
>;

export type TrackListSortDir = "asc" | "desc";

export type TrackListPresetId = "library" | "album" | "artist";

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

const INDEX_COL: TrackListColumnDef = {
  id: "index",
  label: "#",
  sortable: true,
  resizable: true,
  align: "center",
};

const TRACK_NUM_COL: TrackListColumnDef = {
  id: "trackNumber",
  label: "#",
  resizable: true,
  align: "center",
};

const TITLE_COL: TrackListColumnDef = {
  id: "title",
  label: "Title",
  sortable: true,
  resizable: true,
};

const ARTIST_COL: TrackListColumnDef = {
  id: "artist",
  label: "Artist",
  sortable: true,
  resizable: true,
  hideable: true,
  secondary: true,
};

const ALBUM_COL: TrackListColumnDef = {
  id: "album",
  label: "Album",
  sortable: true,
  resizable: true,
  hideable: true,
  secondary: true,
};

const ALBUM_ARTIST_COL: TrackListColumnDef = {
  id: "albumArtist",
  label: "Album artist",
  sortable: false,
  resizable: true,
  hideable: true,
  secondary: true,
};

const DURATION_COL: TrackListColumnDef = {
  id: "duration",
  label: "Duration",
  sortable: true,
  resizable: true,
  align: "right",
};

const YEAR_COL: TrackListColumnDef = {
  id: "year",
  label: "Year",
  sortable: true,
  resizable: true,
  hideable: true,
  align: "right",
  secondary: true,
};

const GENRE_COL: TrackListColumnDef = {
  id: "genre",
  label: "Genre",
  sortable: true,
  resizable: true,
  hideable: true,
  secondary: true,
};

const DISC_COL: TrackListColumnDef = {
  id: "discNumber",
  label: "Disc",
  resizable: true,
  hideable: true,
  align: "center",
  secondary: true,
};

export const TRACK_LIST_PRESETS: Record<TrackListPresetId, TrackListPreset> = {
  library: {
    id: "library",
    indexColumn: "index",
    columns: [
      INDEX_COL,
      TITLE_COL,
      ARTIST_COL,
      ALBUM_COL,
      ALBUM_ARTIST_COL,
      YEAR_COL,
      GENRE_COL,
      DISC_COL,
      DURATION_COL,
    ],
  },
  album: {
    id: "album",
    indexColumn: "trackNumber",
    columns: [TRACK_NUM_COL, TITLE_COL, DURATION_COL],
  },
  artist: {
    id: "artist",
    indexColumn: "trackNumber",
    columns: [TRACK_NUM_COL, TITLE_COL, ALBUM_COL, DURATION_COL],
  },
};

export const DEFAULT_COLUMN_WIDTHS: Partial<Record<TrackListColumnId, number>> =
  {
    index: 40,
    trackNumber: 40,
    title: 240,
    artist: 140,
    album: 160,
    albumArtist: 140,
    duration: 72,
    year: 56,
    genre: 120,
    discNumber: 44,
  };

export const MIN_COLUMN_WIDTHS: Partial<Record<TrackListColumnId, number>> = {
  index: 32,
  trackNumber: 32,
  title: 96,
  artist: 72,
  album: 72,
  albumArtist: 72,
  duration: 64,
  year: 44,
  genre: 56,
  discNumber: 36,
};

const LIBRARY_DEFAULT_HIDDEN: TrackListColumnId[] = [
  "albumArtist",
  "year",
  "genre",
  "discNumber",
];

export function defaultHiddenColumns(
  presetId: TrackListPresetId,
): TrackListColumnId[] {
  if (presetId === "library") return [...LIBRARY_DEFAULT_HIDDEN];
  return [];
}
