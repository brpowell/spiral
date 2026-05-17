export type ImportMode = "ask" | "copy" | "reference";

export interface LibrarySettings {
  mediaFolder: string;
  databasePath: string;
  autoOrganize: boolean;
  importMode: ImportMode;
  defaultMediaFolder: string;
  defaultDatabasePath: string;
  defaultLibraryRoot: string;
}

export interface LibrarySettingsPatch {
  mediaFolder?: string;
  databasePath?: string;
  autoOrganize?: boolean;
  importMode?: ImportMode;
}
