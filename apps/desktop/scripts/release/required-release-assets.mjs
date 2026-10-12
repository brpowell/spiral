/**
 * Single source of truth for draft-release assets required before publish.
 * Used by `check-release-assets.mjs`, `publish-release.mjs`, and CI gates.
 *
 * macOS ships a single universal DMG and updater bundle (`_universal`).
 * Linux ships AppImage (download + Tauri updater payload), `.deb` and `.rpm`
 * for x64 and aarch64. Tauri names them `_amd64` / `_aarch64` (AppImage),
 * `_amd64` / `_arm64` (deb) and `.x86_64` / `.aarch64` (rpm). Windows NSIS
 * installers are `_x64-setup.exe` and `_arm64-setup.exe`.
 */
export const REQUIRED_RELEASE_ASSETS = [
  // Installers (browser download)
  { pattern: /_universal\.dmg$/, label: "macOS universal DMG" },
  { pattern: /_x64-setup\.exe$/, label: "Windows x64 NSIS installer" },
  { pattern: /_arm64-setup\.exe$/, label: "Windows arm64 NSIS installer" },
  { pattern: /_amd64\.AppImage$/, label: "Linux x64 AppImage" },
  { pattern: /_aarch64\.AppImage$/, label: "Linux aarch64 AppImage" },
  { pattern: /_amd64\.deb$/, label: "Linux x64 .deb" },
  { pattern: /_arm64\.deb$/, label: "Linux aarch64 .deb" },
  { pattern: /\.x86_64\.rpm$/, label: "Linux x64 .rpm" },
  { pattern: /\.aarch64\.rpm$/, label: "Linux aarch64 .rpm" },

  // Updater payloads (in-app auto-update)
  {
    pattern: /_universal\.app\.tar\.gz$/,
    label: "macOS universal updater bundle",
  },
  {
    pattern: /_universal\.app\.tar\.gz\.sig$/,
    label: "macOS universal updater signature",
  },
  {
    pattern: /_x64-setup\.exe\.sig$/,
    label: "Windows x64 NSIS updater signature",
  },
  {
    pattern: /_arm64-setup\.exe\.sig$/,
    label: "Windows arm64 NSIS updater signature",
  },
  {
    pattern: /_amd64\.AppImage\.sig$/,
    label: "Linux x64 AppImage updater signature",
  },
  {
    pattern: /_aarch64\.AppImage\.sig$/,
    label: "Linux aarch64 AppImage updater signature",
  },
];

/**
 * @param {string[]} assetNames
 * @returns {{ ok: true } | { ok: false, missing: { pattern: string, label: string }[] }}
 */
export function checkReleaseAssets(assetNames) {
  const missing = [];
  for (const { pattern, label } of REQUIRED_RELEASE_ASSETS) {
    if (!assetNames.some((name) => pattern.test(name))) {
      missing.push({ pattern: pattern.source, label });
    }
  }
  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}
