/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Set to `1` or `true` to allow updater checks/installs during `tauri dev`. */
  readonly SPIRAL_ENABLE_UPDATER?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
