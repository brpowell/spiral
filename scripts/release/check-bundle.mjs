#!/usr/bin/env node
/**
 * Assert a packaged tree is shippable: libmp3lame where the loader looks,
 * no developer Cargo bins (read_tags, wms_import, skin_convert_compare),
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

function linuxAppDirs(paths) {
  return paths.filter(
    (p) => p.endsWith(".AppDir") && existsSync(p) && statSync(p).isDirectory(),
  );
}

function linuxAppImages(paths) {
  return paths.filter(
    (p) => p.endsWith(".AppImage") && isBundlePath(p) && existsSync(p),
  );
}

function linuxAppDirBinaries(appDir) {
  const binDir = join(appDir, "usr", "bin");
  if (!existsSync(binDir)) return [];
  return readdirSync(binDir)
    .filter((name) => name !== "." && name !== "..")
    .map((name) => join(binDir, name))
    .filter((p) => {
      try {
        return statSync(p).isFile();
      } catch {
        return false;
      }
    });
}

function checkLinuxLdd(bin) {
  const ldd = execFileSync("ldd", [bin], { encoding: "utf8" });
  const line = ldd.split("\n").find((row) => row.includes("libmp3lame.so.0"));
  if (!line || /not found/.test(line)) {
    fail(`${bin} does not resolve bundled libmp3lame.so.0:\n${ldd}`);
  }
  console.log(`ok ldd ${bin} → ${line.trim()}`);
}

function checkLame(paths, apps, debs) {
  const foundDylib = apps
    .map((app) => join(app, "Contents", "Frameworks", "libmp3lame.0.dylib"))
    .find((p) => existsSync(p));
  const foundDll = paths.find(
    (p) =>
      p.endsWith("libmp3lame.dll") && p.includes(`${join("bundle", "nsis")}`),
  );
  const foundSo =
    paths.find((p) =>
      p.endsWith(join("usr", "lib", "spiral", "libmp3lame.so.0")),
    ) ||
    paths.find(
      (p) => p.endsWith("libmp3lame.so.0") && p.includes(`${join("bundle")}`),
    );

  if (process.platform === "darwin") {
    if (!foundDylib) {
      fail(
        "packaged Spiral.app is missing Contents/Frameworks/libmp3lame.0.dylib",
      );
    }
    const exe = join(foundDylib, "..", "..", "MacOS", "Spiral");
    if (existsSync(exe)) {
      const otool = execFileSync("otool", ["-L", exe], { encoding: "utf8" });
      if (!otool.includes("libmp3lame.0.dylib")) {
        fail(`Spiral binary does not link libmp3lame.0.dylib:\n${otool}`);
      }
    }
    console.log(`ok ${foundDylib}`);
    return;
  }

  if (process.platform === "win32") {
    if (!foundDll) {
      fail("packaged tree is missing libmp3lame.dll next to the app");
    }
    console.log(`ok ${foundDll}`);
    return;
  }

  const appDirs = linuxAppDirs(paths);
  const appImages = linuxAppImages(paths);
  let ok = Boolean(foundSo);
  if (foundSo) console.log(`ok ${foundSo}`);
  for (const image of appImages) {
    console.log(`ok ${image}`);
    ok = true;
  }
  for (const appDir of appDirs) {
    const so = join(appDir, "usr", "lib", "spiral", "libmp3lame.so.0");
    if (!existsSync(so)) {
      fail(`${appDir} is missing usr/lib/spiral/libmp3lame.so.0`);
    }
    console.log(`ok ${so}`);
    const bins = linuxAppDirBinaries(appDir).filter((p) => {
      const name = basename(p);
      return name === "Spiral" || name === "spiral";
    });
    if (bins.length === 0) {
      fail(`${appDir} usr/bin is missing the Spiral binary`);
    }
    for (const bin of bins) checkLinuxLdd(bin);
    ok = true;
  }
  for (const deb of debs) {
    const listing = execFileSync("dpkg-deb", ["-c", deb], { encoding: "utf8" });
    if (!listing.includes("libmp3lame.so.0")) {
      fail(`${deb} does not contain libmp3lame.so.0`);
    }
    console.log(`ok ${deb} contains libmp3lame.so.0`);
    ok = true;
  }
  if (!ok) {
    fail(
      "packaged Linux tree is missing usr/lib/spiral/libmp3lame.so.0 (AppDir) and no AppImage/.deb listed it",
    );
  }
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
checkLame(paths, apps, debs);
checkDevBins(paths, apps, debs);
checkLicenseKeys(paths, apps);
