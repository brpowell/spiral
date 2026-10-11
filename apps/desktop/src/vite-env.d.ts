/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Set to `1` or `true` to allow updater checks/installs during `tauri dev`. */
  readonly SPIRAL_ENABLE_UPDATER?: string;
  /** Full What's New history URL. Unset uses https://spiralpowered.com/api/releases. */
  readonly SPIRAL_RELEASES_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
