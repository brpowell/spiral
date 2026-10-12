import { describe, expect, it } from "vitest";
import { checkReleaseAssets } from "./required-release-assets.mjs";

/** Typical tauri-action filenames for a complete Direct cut. */
const COMPLETE = [
  "Spiral_0.2.2_aarch64.dmg",
  "Spiral_0.2.2_x64.dmg",
  "Spiral_0.2.2_x64-setup.exe",
  "Spiral_0.2.2_arm64-setup.exe",
  "Spiral_0.2.2_amd64.AppImage",
  "Spiral_0.2.2_aarch64.AppImage",
  "Spiral_0.2.2_amd64.deb",
  "Spiral_0.2.2_arm64.deb",
  "Spiral-0.2.2-1.x86_64.rpm",
  "Spiral-0.2.2-1.aarch64.rpm",
  "Spiral_0.2.2_aarch64.app.tar.gz",
  "Spiral_0.2.2_aarch64.app.tar.gz.sig",
  "Spiral_0.2.2_x64.app.tar.gz",
  "Spiral_0.2.2_x64.app.tar.gz.sig",
  "Spiral_0.2.2_x64-setup.exe.sig",
  "Spiral_0.2.2_arm64-setup.exe.sig",
  "Spiral_0.2.2_amd64.AppImage.sig",
  "Spiral_0.2.2_aarch64.AppImage.sig",
];

function labelsOf(missing) {
  return missing.map((m) => m.label);
}

describe("checkReleaseAssets", () => {
  it("accepts a complete Direct set", () => {
    expect(checkReleaseAssets(COMPLETE)).toEqual({ ok: true });
  });

  it("requires Windows arm64 alongside x64", () => {
    const withoutArm = COMPLETE.filter((n) => !n.includes("_arm64-setup"));
    const result = checkReleaseAssets(withoutArm);
    expect(result.ok).toBe(false);
    expect(labelsOf(result.missing)).toEqual([
      "Windows arm64 NSIS installer",
      "Windows arm64 NSIS updater signature",
    ]);
  });

  it("does not let one Windows arch satisfy the other", () => {
    const withoutX64 = COMPLETE.filter((n) => !n.includes("_x64-setup"));
    const result = checkReleaseAssets(withoutX64);
    expect(result.ok).toBe(false);
    expect(labelsOf(result.missing)).toEqual([
      "Windows x64 NSIS installer",
      "Windows x64 NSIS updater signature",
    ]);
  });

  it("requires .deb and .rpm for both Linux arches", () => {
    const withoutPackages = COMPLETE.filter(
      (n) => !n.endsWith(".deb") && !n.endsWith(".rpm"),
    );
    const result = checkReleaseAssets(withoutPackages);
    expect(result.ok).toBe(false);
    expect(labelsOf(result.missing)).toEqual([
      "Linux x64 .deb",
      "Linux aarch64 .deb",
      "Linux x64 .rpm",
      "Linux aarch64 .rpm",
    ]);
  });

  it("requires both AppImages and their updater signatures", () => {
    const withoutAmd64 = COMPLETE.filter((n) => !n.includes("_amd64.AppImage"));
    const amd64 = checkReleaseAssets(withoutAmd64);
    expect(amd64.ok).toBe(false);
    expect(labelsOf(amd64.missing)).toEqual([
      "Linux x64 AppImage",
      "Linux x64 AppImage updater signature",
    ]);

    const withoutAarch64Sig = COMPLETE.filter(
      (n) => n !== "Spiral_0.2.2_aarch64.AppImage.sig",
    );
    const aarch64Sig = checkReleaseAssets(withoutAarch64Sig);
    expect(aarch64Sig.ok).toBe(false);
    expect(labelsOf(aarch64Sig.missing)).toEqual([
      "Linux aarch64 AppImage updater signature",
    ]);
  });

  it("does not treat .deb or .rpm as a substitute for AppImage", () => {
    const packagesOnly = COMPLETE.filter((n) => !n.includes(".AppImage"));
    const result = checkReleaseAssets(packagesOnly);
    expect(result.ok).toBe(false);
    expect(labelsOf(result.missing)).toEqual([
      "Linux x64 AppImage",
      "Linux aarch64 AppImage",
      "Linux x64 AppImage updater signature",
      "Linux aarch64 AppImage updater signature",
    ]);
  });
});
