#!/usr/bin/env node
/**
 * Authenticode-sign a Windows file with Azure Artifact Signing.
 *
 * Tauri runs this through bundle.windows.signCommand (injected by CI via
 * TAURI_CONFIG, never committed) for the app exe and the NSIS installer.
 *
 * Usage:
 *   node scripts/release/sign-windows.mjs <file>
 *
 * Environment:
 *   AZURE_SIGNING_ENDPOINT  — regional endpoint, e.g. https://eus.codesigning.azure.net
 *   AZURE_SIGNING_ACCOUNT   — Artifact Signing account name
 *   AZURE_SIGNING_PROFILE   — certificate profile name
 *
 * Auth: the dlib uses DefaultAzureCredential, so an `azure/login` step (OIDC)
 * before the build is enough. No client secret is read here.
 *
 * Verifies the signature after signing, so a bad result fails the Tauri build
 * before tauri-action uploads anything.
 *
 * Always uses the x64 signtool and dlib, including on the Windows ARM runner:
 * signing does not depend on the host architecture and x64 runs under
 * emulation there.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const CLIENT_PACKAGE = "Microsoft.ArtifactSigning.Client";
export const CLIENT_VERSION = "1.0.146";
export const TIMESTAMP_URL = "http://timestamp.acs.microsoft.com";

// The signing client authenticates with DefaultAzureCredential. Left alone it
// probes managed identity and falls back to an interactive browser, which can
// stall a CI runner for minutes. Keep only the Azure CLI login that
// `azure/login` sets up.
export const EXCLUDED_CREDENTIALS = [
  "EnvironmentCredential",
  "WorkloadIdentityCredential",
  "ManagedIdentityCredential",
  "SharedTokenCacheCredential",
  "VisualStudioCredential",
  "VisualStudioCodeCredential",
  "AzurePowerShellCredential",
  "AzureDeveloperCliCredential",
  "InteractiveBrowserCredential",
];

// Fail loudly instead of hanging the release build; Tauri captures our output
// until we exit, so a hang would otherwise be silent.
export const DOWNLOAD_TIMEOUT_MS = 60_000;
export const SIGNTOOL_TIMEOUT_MS = 180_000;

export function metadataJson({ endpoint, account, profile }) {
  return JSON.stringify({
    Endpoint: endpoint,
    CodeSigningAccountName: account,
    CertificateProfileName: profile,
    ExcludeCredentials: EXCLUDED_CREDENTIALS,
  });
}

export function signtoolArgs({ dlibPath, metadataPath, file }) {
  return [
    "sign",
    "/v",
    "/fd",
    "SHA256",
    "/tr",
    TIMESTAMP_URL,
    "/td",
    "SHA256",
    "/dlib",
    dlibPath,
    "/dmdf",
    metadataPath,
    file,
  ];
}

export function verifyArgs(file) {
  return ["verify", "/pa", "/v", file];
}

/** Highest Windows SDK version that ships an x64 signtool. */
export function findSigntool(kitsBin) {
  if (!existsSync(kitsBin)) return null;
  const versions = readdirSync(kitsBin)
    .filter((v) => /^10\.\d+\.\d+\.\d+$/.test(v))
    .sort((a, b) => {
      const pa = a.split(".").map(Number);
      const pb = b.split(".").map(Number);
      for (let i = 0; i < pa.length; i++) {
        if (pa[i] !== pb[i]) return pb[i] - pa[i];
      }
      return 0;
    });
  for (const v of versions) {
    const candidate = join(kitsBin, v, "x64", "signtool.exe");
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

async function ensureDlib(cacheDir) {
  const dlib = join(
    cacheDir,
    "lib",
    "bin",
    "x64",
    "Azure.CodeSigning.Dlib.dll",
  );
  if (existsSync(dlib)) return dlib;

  mkdirSync(join(cacheDir, "lib"), { recursive: true });
  const archive = join(cacheDir, `${CLIENT_PACKAGE}.${CLIENT_VERSION}.zip`);
  const url = `https://www.nuget.org/api/v2/package/${CLIENT_PACKAGE}/${CLIENT_VERSION}`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Could not download ${url}: HTTP ${res.status}`);
  writeFileSync(archive, Buffer.from(await res.arrayBuffer()));

  // bsdtar ships with Windows and reads zip archives.
  const untar = spawnSync(
    "tar",
    ["-xf", archive, "-C", join(cacheDir, "lib")],
    {
      stdio: "inherit",
    },
  );
  if (untar.status !== 0)
    throw new Error("Could not extract the signing client");
  if (!existsSync(dlib)) throw new Error(`Signing client missing ${dlib}`);
  return dlib;
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: sign-windows.mjs <file>");
    process.exit(2);
  }

  const kitsBin =
    process.env.WINDOWS_KITS_BIN ??
    join(
      process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
      "Windows Kits",
      "10",
      "bin",
    );
  const signtool = process.env.SIGNTOOL_PATH ?? findSigntool(kitsBin);
  if (!signtool) throw new Error(`No x64 signtool.exe found under ${kitsBin}`);

  const cacheDir = join(homedir(), ".spiral-artifact-signing");
  mkdirSync(cacheDir, { recursive: true });
  const dlibPath = await ensureDlib(cacheDir);

  const metadataPath = join(cacheDir, "metadata.json");
  writeFileSync(
    metadataPath,
    metadataJson({
      endpoint: requireEnv("AZURE_SIGNING_ENDPOINT"),
      account: requireEnv("AZURE_SIGNING_ACCOUNT"),
      profile: requireEnv("AZURE_SIGNING_PROFILE"),
    }),
  );

  const signed = spawnSync(
    signtool,
    signtoolArgs({ dlibPath, metadataPath, file }),
    { stdio: "inherit", timeout: SIGNTOOL_TIMEOUT_MS },
  );
  if (signed.error?.code === "ETIMEDOUT") {
    throw new Error(
      `signtool did not finish within ${SIGNTOOL_TIMEOUT_MS / 1000}s; likely stuck authenticating to Azure`,
    );
  }
  if (signed.status !== 0) process.exit(signed.status ?? 1);

  // Fail the build here, before anything is uploaded, if the result is not a
  // valid trusted signature.
  const verified = spawnSync(signtool, verifyArgs(file), {
    stdio: "inherit",
    timeout: SIGNTOOL_TIMEOUT_MS,
  });
  process.exit(verified.status ?? 1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`Signing failed: ${err.message}`);
    process.exit(1);
  });
}
