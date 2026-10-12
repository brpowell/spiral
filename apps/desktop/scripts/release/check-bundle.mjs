#!/usr/bin/env node
/**
 * Assert a packaged tree is shippable: no developer Cargo bins
 * (read_tags, wms_import, skin_convert_compare).
 *
 * Walks `target` after `tauri build` / `npm run release -- installer`.
 *
 * Usage: npm run release -- check-bundle
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const targetRoot =
  process.env.CARGO_TARGET_DIR || join(root, "..", "..", "target");

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

function checkDevBins(paths, apps, debs, rpms) {
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

  for (const rpm of rpms) {
    const listing = execFileSync("rpm", ["-qlp", rpm], { encoding: "utf8" });
    const hits = [...DEV_BINS].filter((name) => listing.includes(name));
    if (hits.length > 0) {
      fail(`${rpm} contains developer binaries: ${hits.join(", ")}`);
    }
    console.log(`ok ${rpm} has no developer binaries`);
  }

  console.log("ok no developer binaries in packaged tree");
}

if (!existsSync(targetRoot)) {
  fail(`no ${targetRoot} — build an installer first`);
}

const paths = walk(targetRoot);
const apps = packagedApps(paths);
const debs = paths.filter((p) => p.endsWith(".deb"));
const rpms = paths.filter((p) => p.endsWith(".rpm"));
checkDevBins(paths, apps, debs, rpms);
