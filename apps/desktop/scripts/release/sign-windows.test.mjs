import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EXCLUDED_CREDENTIALS,
  TIMESTAMP_URL,
  findSigntool,
  metadataJson,
  signtoolArgs,
  verifyArgs,
} from "./sign-windows.mjs";

function fakeKits(versions) {
  const root = mkdtempSync(join(tmpdir(), "kits-"));
  for (const v of versions) {
    mkdirSync(join(root, v, "x64"), { recursive: true });
    writeFileSync(join(root, v, "x64", "signtool.exe"), "");
  }
  return root;
}

describe("metadataJson", () => {
  it("uses the field names the signing client reads", () => {
    const json = JSON.parse(
      metadataJson({
        endpoint: "https://eus.codesigning.azure.net",
        account: "acct",
        profile: "prof",
      }),
    );
    expect(json).toEqual({
      Endpoint: "https://eus.codesigning.azure.net",
      CodeSigningAccountName: "acct",
      CertificateProfileName: "prof",
      ExcludeCredentials: EXCLUDED_CREDENTIALS,
    });
  });

  it("keeps the Azure CLI credential and drops the ones that stall CI", () => {
    expect(EXCLUDED_CREDENTIALS).not.toContain("AzureCliCredential");
    expect(EXCLUDED_CREDENTIALS).toContain("ManagedIdentityCredential");
    expect(EXCLUDED_CREDENTIALS).toContain("InteractiveBrowserCredential");
  });
});

describe("signtoolArgs", () => {
  it("timestamps, uses SHA256, and signs the file last", () => {
    const args = signtoolArgs({
      dlibPath: "d.dll",
      metadataPath: "m.json",
      file: "app.exe",
    });
    expect(args[0]).toBe("sign");
    expect(args[args.indexOf("/tr") + 1]).toBe(TIMESTAMP_URL);
    expect(args[args.indexOf("/fd") + 1]).toBe("SHA256");
    expect(args[args.indexOf("/dlib") + 1]).toBe("d.dll");
    expect(args[args.indexOf("/dmdf") + 1]).toBe("m.json");
    expect(args.at(-1)).toBe("app.exe");
  });
});

describe("verifyArgs", () => {
  it("checks the default authenticode policy on the file", () => {
    expect(verifyArgs("app.exe")).toEqual(["verify", "/pa", "/v", "app.exe"]);
  });
});

describe("findSigntool", () => {
  it("picks the highest SDK version, comparing numerically", () => {
    const root = fakeKits(["10.0.19041.0", "10.0.26100.0", "10.0.9000.0"]);
    expect(findSigntool(root)).toBe(
      join(root, "10.0.26100.0", "x64", "signtool.exe"),
    );
  });

  it("skips versions without an x64 signtool", () => {
    const root = fakeKits(["10.0.19041.0"]);
    mkdirSync(join(root, "10.0.26100.0"), { recursive: true });
    expect(findSigntool(root)).toBe(
      join(root, "10.0.19041.0", "x64", "signtool.exe"),
    );
  });

  it("returns null when the SDK is absent", () => {
    expect(findSigntool(join(tmpdir(), "no-such-kits-dir"))).toBeNull();
  });
});
