export type ImportMode = "ask" | "copy" | "reference";

export type CdMetadataFetchMode = "ask" | "always" | "never";

export interface LibrarySettings {
  mediaFolder: string;
  databasePath: string;
  autoOrganize: boolean;
  /** Full relative path under the media folder. Use `/` between folders. */
  organizePathFormat: string;
  defaultOrganizePathFormat: string;
  importMode: ImportMode;
  cdMetadataFetchMode: CdMetadataFetchMode;
  defaultMediaFolder: string;
  defaultDatabasePath: string;
  defaultLibraryRoot: string;
  metadataBackupsEnabled: boolean;
  metadataBackupRetentionDays: number;
}

export interface LibrarySettingsPatch {
  mediaFolder?: string;
  databasePath?: string;
  autoOrganize?: boolean;
  organizePathFormat?: string;
  importMode?: ImportMode;
  cdMetadataFetchMode?: CdMetadataFetchMode;
  metadataBackupsEnabled?: boolean;
  metadataBackupRetentionDays?: number;
}
