#!/usr/bin/env node
/**
 * Assert a packaged tree is shippable: no developer Cargo bins (read_tags, wms_import, skin_convert_compare),
 * and the bundled license public key matches the build (production by
 * default; development only when SPIRAL_LICENSE_DEV_KEY=1).
 *
 * Walks `src-tauri/target` after `tauri build` / `npm run release -- installer`.
 *
 * Usage: npm run release -- check-bundle
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const targetRoot =
  process.env.CARGO_TARGET_DIR || join(root, "src-tauri", "target");

const DEV_BINS = new Set(["read_tags", "skin_convert_compare", "wms_import"]);

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name === "deps" ||
        entry.name === "incremental" ||
        entry.name === ".fingerprint"
      ) {
        continue;
      }
      out.push(path);
      walk(path, out);
    } else {
      out.push(path);
    }
  }
  return out;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function isBundlePath(p) {
  return p.split(/[/\\]/).includes("bundle");
}

function isDevBinName(fileName) {
  return DEV_BINS.has(fileName.replace(/\.exe$/i, ""));
}

function packagedApps(paths) {
  return paths.filter(
    (p) =>
      p.endsWith(".app") && statSync(p).isDirectory() && !p.includes(".app/"),
  );
}

function checkDevBins(paths, apps, debs) {
  const bundlePaths = paths.filter(isBundlePath);
  if (bundlePaths.length === 0) {
    fail(`no bundled tree under ${targetRoot} — build an installer first`);
  }

  const leaked = bundlePaths.filter((p) => {
    try {
      return !statSync(p).isDirectory() && isDevBinName(basename(p));
    } catch {
      return false;
    }
  });
  if (leaked.length > 0) {
    fail(
      `developer binaries must not ship in the bundle:\n${leaked.map((p) => `  ${p}`).join("\n")}`,
    );
  }

  for (const app of apps) {
    const macOs = join(app, "Contents", "MacOS");
    if (!existsSync(macOs)) continue;
    const names = readdirSync(macOs).filter((name) => name !== ".DS_Store");
    const extra = names.filter((name) => name !== "Spiral");
    if (extra.length > 0) {
      fail(`${macOs} must contain only Spiral; found: ${names.join(", ")}`);
    }
    if (!names.includes("Spiral")) {
      fail(`${macOs} is missing Spiral`);
    }
    console.log(`ok ${macOs} contains only Spiral`);
  }

  for (const deb of debs) {
    const listing = execFileSync("dpkg-deb", ["-c", deb], { encoding: "utf8" });
    const hits = [...DEV_BINS].filter((name) => listing.includes(name));
    if (hits.length > 0) {
      fail(`${deb} contains developer binaries: ${hits.join(", ")}`);
    }
    console.log(`ok ${deb} has no developer binaries`);
  }

  console.log("ok no developer binaries in packaged tree");
}

function bufferContains(haystack, needle) {
  if (needle.length === 0) return false;
  return haystack.includes(needle);
}

function packagedExecutables(paths, apps) {
  const bins = [];
  for (const app of apps) {
    const exe = join(app, "Contents", "MacOS", "Spiral");
    if (existsSync(exe) && statSync(exe).isFile()) {
      bins.push(exe);
    }
  }
  for (const p of paths.filter(isBundlePath)) {
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    const name = basename(p);
    if (
      name === "Spiral" ||
      name === "spiral" ||
      name === "Spiral.exe" ||
      name.endsWith("-setup.exe")
    ) {
      bins.push(p);
    }
  }
  return [...new Set(bins)];
}

function checkLicenseKeys(paths, apps) {
  const wantDev = process.env.SPIRAL_LICENSE_DEV_KEY === "1";
  const licenseDir = join(root, "src-tauri", "keys", "license");
  const devPub = readFileSync(join(licenseDir, "dev-ed25519.pub"));
  const prodPub = readFileSync(join(licenseDir, "prod-ed25519.pub"));
  const required = wantDev ? devPub : prodPub;
  const forbidden = wantDev ? prodPub : devPub;
  const requiredLabel = wantDev ? "development" : "production";
  const forbiddenLabel = wantDev ? "production" : "development";

  const bins = packagedExecutables(paths, apps);
  if (bins.length === 0) {
    fail("no packaged Spiral executable found to check license public keys");
  }

  for (const bin of bins) {
    const body = readFileSync(bin);
    if (!bufferContains(body, required)) {
      fail(`${bin} is missing the ${requiredLabel} license public key`);
    }
    if (bufferContains(body, forbidden)) {
      fail(
        `${bin} must not contain the ${forbiddenLabel} license public key (set SPIRAL_LICENSE_DEV_KEY=1 only for --features license-dev-key builds)`,
      );
    }
    console.log(`ok ${bin} license public key is ${requiredLabel}`);
  }
}

if (!existsSync(targetRoot)) {
  fail(`no ${targetRoot} — build an installer first`);
}

const paths = walk(targetRoot);
const apps = packagedApps(paths);
const debs = paths.filter((p) => p.endsWith(".deb"));
checkDevBins(paths, apps, debs);
checkLicenseKeys(paths, apps);
