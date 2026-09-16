import { describe, expect, it } from "vitest";
import {
  REQUIRED_RELEASE_ASSETS,
  checkReleaseAssets,
} from "./required-release-assets.mjs";

/** Typical tauri-action filenames for a complete Direct cut. */
const COMPLETE = [
  "Spiral_0.2.2_aarch64.dmg",
  "Spiral_0.2.2_x64.dmg",
  "Spiral_0.2.2_x64-setup.exe",
  "Spiral_0.2.2_amd64.AppImage",
  "Spiral_0.2.2_aarch64.AppImage",
  "Spiral_0.2.2_aarch64.app.tar.gz",
  "Spiral_0.2.2_aarch64.app.tar.gz.sig",
  "Spiral_0.2.2_x64.app.tar.gz",
  "Spiral_0.2.2_x64.app.tar.gz.sig",
  "Spiral_0.2.2_x64-setup.exe.sig",
  "Spiral_0.2.2_amd64.AppImage.sig",
  "Spiral_0.2.2_aarch64.AppImage.sig",
];

function labelsOf(missing) {
  return missing.map((m) => m.label);
}

describe("checkReleaseAssets", () => {
  it("accepts a complete Direct set without .deb packages", () => {
    expect(checkReleaseAssets(COMPLETE)).toEqual({ ok: true });
  });

  it("does not require .deb (optional later, #333)", () => {
    expect(
      REQUIRED_RELEASE_ASSETS.some(({ pattern }) => pattern.test("x.deb")),
    ).toBe(false);
    expect(
      checkReleaseAssets([
        ...COMPLETE,
        "Spiral_0.2.2_amd64.deb",
        "Spiral_0.2.2_arm64.deb",
      ]),
    ).toEqual({ ok: true });
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

  it("does not treat .deb as a substitute for AppImage", () => {
    const debsInstead = COMPLETE.filter((n) => !n.includes(".AppImage")).concat(
      ["Spiral_0.2.2_amd64.deb", "Spiral_0.2.2_arm64.deb"],
    );
    const result = checkReleaseAssets(debsInstead);
    expect(result.ok).toBe(false);
    expect(labelsOf(result.missing)).toEqual([
      "Linux x64 AppImage",
      "Linux aarch64 AppImage",
      "Linux x64 AppImage updater signature",
      "Linux aarch64 AppImage updater signature",
    ]);
  });
});
