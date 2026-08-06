/**
 * Single source of truth for draft-release assets required before publish.
 * Used by `check-release-assets.mjs`, `publish-release.mjs`, and CI gates.
 *
 * Linux: AppImage is the updater payload (Tauri createUpdaterArtifacts);
 * `.deb` is the browser-download installer. Flatpak/rpm stay out of Direct.
 * Deb uses Debian arch names (`amd64` / `arm64`); AppImage uses Rust triples
 * (`amd64` / `aarch64` in Tauri’s filenames).
 */
export const REQUIRED_RELEASE_ASSETS = [
  // Installers (browser download)
  { pattern: /_aarch64\.dmg$/, label: "macOS aarch64 DMG" },
  { pattern: /_(x64|x86_64)\.dmg$/, label: "macOS x64 DMG" },
  { pattern: /-setup\.exe$/, label: "Windows NSIS installer" },
  { pattern: /_amd64\.deb$/, label: "Linux x64 deb" },
  { pattern: /_arm64\.deb$/, label: "Linux aarch64 deb" },

  // Updater payloads (in-app auto-update)
  { pattern: /_aarch64\.app\.tar\.gz$/, label: "macOS aarch64 updater bundle" },
  {
    pattern: /_aarch64\.app\.tar\.gz\.sig$/,
    label: "macOS aarch64 updater signature",
  },
  {
    pattern: /_(x64|x86_64)\.app\.tar\.gz$/,
    label: "macOS x64 updater bundle",
  },
  {
    pattern: /_(x64|x86_64)\.app\.tar\.gz\.sig$/,
    label: "macOS x64 updater signature",
  },
  { pattern: /-setup\.exe\.sig$/, label: "Windows NSIS updater signature" },
  { pattern: /_amd64\.AppImage$/, label: "Linux x64 AppImage" },
  {
    pattern: /_amd64\.AppImage\.sig$/,
    label: "Linux x64 AppImage updater signature",
  },
  { pattern: /_aarch64\.AppImage$/, label: "Linux aarch64 AppImage" },
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
