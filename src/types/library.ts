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
  /** Root directory; media lives in `Media/` and the DB is `Library.db` here. */
  libraryRoot: string;
  mediaFolder: string;
  databasePath: string;
  autoOrganize: boolean;
  /** Full relative path under the media folder. Use `/` between folders. */
  organizePathFormat: string;
  defaultOrganizePathFormat: string;
  importMode: ImportMode;
  cdMetadataFetchMode: CdMetadataFetchMode;
  cdImportProfileId: string;
  defaultLibraryRoot: string;
  metadataBackupsEnabled: boolean;
  metadataBackupRetentionDays: number;
  listeningHistoryEnabled: boolean;
  lyricsSidecarSyncEnabled: boolean;
  lyricsAutoFetchInLightbox: boolean;
}

export interface LibrarySettingsPatch {
  libraryRoot?: string;
  autoOrganize?: boolean;
  organizePathFormat?: string;
  importMode?: ImportMode;
  cdMetadataFetchMode?: CdMetadataFetchMode;
  cdImportProfileId?: string;
  metadataBackupsEnabled?: boolean;
  metadataBackupRetentionDays?: number;
  listeningHistoryEnabled?: boolean;
  lyricsSidecarSyncEnabled?: boolean;
  lyricsAutoFetchInLightbox?: boolean;
}
