import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const tauriDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../src-tauri",
);
const conf = JSON.parse(
  readFileSync(join(tauriDir, "tauri.conf.json"), "utf8"),
);

describe("Windows installer branding", () => {
  // Without these NSIS falls back to its generic icon for the installer exe.
  it.each(["installerIcon", "uninstallerIcon"])(
    "sets %s to an existing .ico",
    (key) => {
      const icon = conf.bundle.windows.nsis[key];
      expect(icon).toMatch(/\.ico$/);
      expect(existsSync(join(tauriDir, icon))).toBe(true);
    },
  );
});
