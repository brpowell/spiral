export type ImportMode = "ask" | "copy" | "reference";

export type CdMetadataFetchMode = "ask" | "always" | "never";

export type LibraryRelocateMode = "move" | "switch" | "fresh" | "freshImport";

export interface LibraryDestinationInfo {
  path: string;
  hasDatabase: boolean;
  audioFileCount: number;
  blockedReason: string | null;
}

export interface LibrarySettings {
  /** Root directory; tracks live in `Tracks/`, artwork in `Artwork/`, DB is `Library.db`. */
  libraryRoot: string;
  mediaFolder: string;
  artworkFolder: string;
  databasePath: string;
  autoOrganize: boolean;
  /** Full relative path under the tracks folder. Use `/` between folders. */
  organizePathFormat: string;
  defaultOrganizePathFormat: string;
  importMode: ImportMode;
  cdMetadataFetchMode: CdMetadataFetchMode;
  cdImportProfileId: string;
  defaultLibraryRoot: string;
  listeningHistoryEnabled: boolean;
  lyricsSidecarSyncEnabled: boolean;
  lyricsAutoFetchInLightbox: boolean;
  /** When true, confirm before opening musicbrainz.org from editors. */
  confirmMusicBrainzExternalLinks: boolean;
  automaticUpdateChecksEnabled: boolean;
  automaticItemUpdateChecksEnabled: boolean;
}

export interface LibrarySettingsPatch {
  libraryRoot?: string;
  autoOrganize?: boolean;
  organizePathFormat?: string;
  importMode?: ImportMode;
  cdMetadataFetchMode?: CdMetadataFetchMode;
  cdImportProfileId?: string;
  listeningHistoryEnabled?: boolean;
  lyricsSidecarSyncEnabled?: boolean;
  lyricsAutoFetchInLightbox?: boolean;
  confirmMusicBrainzExternalLinks?: boolean;
  automaticUpdateChecksEnabled?: boolean;
  automaticItemUpdateChecksEnabled?: boolean;
}
