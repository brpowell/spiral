#!/usr/bin/env node
/**
 * Generate the committed third-party license bundle:
 *
 * - `src-tauri/NOTICE`: bundled as a Tauri resource. A package inventory, plus
 *   each distinct license text once with every package (and its copyright line)
 *   that uses it.
 * - `src/assets/licenses/third-party.json`: the same data, rendered by
 *   About Spiral -> Licenses.
 *
 * What counts as "shipped":
 * - npm: production dependencies from package-lock (dev-only packages excluded)
 * - cargo: `cargo tree -p Spiral -e normal,build --target all`, i.e. the crates in
 *   the app's own feature-resolved graph on every platform. `cargo metadata` is
 *   not used for membership because in a workspace it resolves features across
 *   every member and would pull in crates only the registry uses.
 *
 * Licenses are read from each package's own license files. A few packages ship
 * none (their authors rely on a repository-level file that is not published);
 * for those the canonical text of the declared license is used, with the
 * manifest's authors as copyright holder. See `scripts/license-templates/`.
 * `scripts/license-overrides.json` corrects wrong or missing license metadata.
 * First-party packages listed in IGNORE_PACKAGES are omitted.
 *
 * Usage:
 *   node scripts/generate-notice.mjs           # write the outputs
 *   node scripts/generate-notice.mjs --check   # fail if they are stale
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildGroups, renderGroups, toUiData } from "./lib/license-bundle.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outPath = path.join(root, "src-tauri/NOTICE");
const uiOutPath = path.join(root, "src/assets/licenses/third-party.json");
const templatesDir = path.join(__dirname, "license-templates");
const overridesPath = path.join(__dirname, "license-overrides.json");
const fdkNoticePath = path.join(root, "src/assets/licenses/FDK-AAC-NOTICE.txt");

/** @typedef {import("./lib/license-bundle.mjs").BundlePackage} BundlePackage */

/**
 * First-party packages omitted from NOTICE (this app and sibling Spiral packages).
 *
 * Patterns:
 *   `name`       exact package name in either ecosystem
 *   `eco:name`   exact name in one ecosystem (`npm:` or `cargo:`)
 *   trailing `*` prefix match (`@spiral/*` for the whole npm scope)
 */
const IGNORE_PACKAGES = ["@spiral/*", "cargo:Spiral", "spk-format"];

/**
 * @param {string} name
 * @param {'npm' | 'cargo'} ecosystem
 */
function isIgnored(name, ecosystem) {
  return IGNORE_PACKAGES.some((pattern) =>
    matchesIgnore(pattern, name, ecosystem),
  );
}

/**
 * @param {string} pattern
 * @param {string} name
 * @param {'npm' | 'cargo'} ecosystem
 */
function matchesIgnore(pattern, name, ecosystem) {
  let rest = pattern;
  const colon = pattern.indexOf(":");
  if (colon !== -1) {
    const eco = pattern.slice(0, colon);
    if (eco === "npm" || eco === "cargo") {
      if (eco !== ecosystem) return false;
      rest = pattern.slice(colon + 1);
    }
  }
  const needle = ecosystem === "cargo" ? rest.toLowerCase() : rest;
  const haystack = ecosystem === "cargo" ? name.toLowerCase() : name;
  if (needle.endsWith("*")) {
    return haystack.startsWith(needle.slice(0, -1));
  }
  return needle === haystack;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

/* ----------------------------- license files ----------------------------- */

const LICENSE_FILE_NAME =
  /^(licen[sc]e|copying|unlicense|notice)(?:[-_.][a-z0-9._-]*)?$/i;
const NOT_A_LICENSE_TEXT =
  /\.(rs|js|mjs|cjs|ts|json|html|py|c|h|toml|ya?ml|sh|png|svg|spdx)$/i;
const MAX_LICENSE_FILE_BYTES = 200 * 1024;

/**
 * License and NOTICE files shipped in a package directory.
 * @param {string} dir
 * @param {string[]} [extraNames] explicit `license-file` from the manifest
 * @returns {import("./lib/license-bundle.mjs").LicenseFile[]}
 */
function readLicenseFiles(dir, extraNames = []) {
  /** @type {string[]} */
  let names;
  try {
    names = fs
      .readdirSync(dir)
      .filter(
        (name) =>
          LICENSE_FILE_NAME.test(name) && !NOT_A_LICENSE_TEXT.test(name),
      );
  } catch {
    return [];
  }
  for (const extra of extraNames) {
    if (
      extra &&
      !names.includes(extra) &&
      fs.existsSync(path.join(dir, extra))
    ) {
      names.push(extra);
    }
  }
  const files = [];
  for (const name of names.sort()) {
    const full = path.join(dir, name);
    try {
      const stat = fs.statSync(full);
      if (
        !stat.isFile() ||
        stat.size === 0 ||
        stat.size > MAX_LICENSE_FILE_BYTES
      )
        continue;
      files.push({
        kind: /^notice/i.test(name) ? "notice" : "license",
        name,
        text: fs.readFileSync(full, "utf8"),
      });
    } catch {
      // unreadable: treated as missing
    }
  }
  return files;
}

/* --------------------------------- npm --------------------------------- */

function formatNpmLicense(license) {
  if (typeof license === "string") return license;
  if (license && typeof license === "object" && license.type)
    return String(license.type);
  return undefined;
}

/**
 * Every production npm package in the lockfile, including nested copies of
 * different versions (identified by their node_modules path).
 * @returns {BundlePackage[]}
 */
function collectNpmPackages() {
  const lock = readJson(path.join(root, "package-lock.json"));
  /** @type {BundlePackage[]} */
  const packages = [];
  for (const [key, entry] of Object.entries(lock.packages ?? {})) {
    if (!key.startsWith("node_modules/")) continue;
    if (entry.dev || entry.devOptional || entry.link) continue;
    const name = key.slice(
      key.lastIndexOf("node_modules/") + "node_modules/".length,
    );
    const dir = path.join(root, key);
    let meta = {};
    try {
      meta = readJson(path.join(dir, "package.json"));
    } catch {
      // not installed (optional platform package): fall back to lockfile data
    }
    const author =
      typeof meta.author === "string" ? meta.author : meta.author?.name;
    const repository =
      typeof meta.repository === "string"
        ? meta.repository
        : meta.repository?.url;
    packages.push({
      name,
      version: entry.version ?? meta.version ?? "unknown",
      ecosystem: "npm",
      license: entry.license ?? formatNpmLicense(meta.license) ?? "UNKNOWN",
      authors: author ? [author] : [],
      repository: repository?.replace(/^git\+/, "").replace(/\.git$/, ""),
      files: readLicenseFiles(dir),
    });
  }
  return packages;
}

/* --------------------------------- cargo --------------------------------- */

/**
 * Crates in the desktop package's own resolved graph, on all platforms.
 * @returns {BundlePackage[]}
 */
function collectCargoPackages() {
  const manifest = path.join(root, "src-tauri/Cargo.toml");
  const run = (args) =>
    execFileSync("cargo", args, {
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      cwd: root,
    });

  const tree = run([
    "tree",
    "--manifest-path",
    manifest,
    "-p",
    "Spiral",
    "-e",
    "normal,build",
    "--target",
    "all",
    "--prefix",
    "none",
    "--no-dedupe",
    "--locked",
    "-f",
    "{p}",
  ]);
  const members = new Set();
  for (const line of tree.split("\n")) {
    const m = line.match(/^(\S+) v(\S+)/);
    if (m) members.add(`${m[1]}@${m[2]}`);
  }

  const metadata = JSON.parse(
    run([
      "metadata",
      "--format-version",
      "1",
      "--locked",
      "--manifest-path",
      manifest,
    ]),
  );

  /** @type {BundlePackage[]} */
  const packages = [];
  for (const pkg of metadata.packages) {
    if (!members.has(`${pkg.name}@${pkg.version}`)) continue;
    const dir = path.dirname(pkg.manifest_path);
    packages.push({
      name: pkg.name,
      version: pkg.version,
      ecosystem: "cargo",
      license:
        pkg.license ?? (pkg.license_file ? "SEE LICENSE FILE" : "UNKNOWN"),
      authors: pkg.authors ?? [],
      repository: pkg.repository ?? undefined,
      files: readLicenseFiles(
        dir,
        pkg.license_file ? [path.basename(pkg.license_file)] : [],
      ),
    });
  }
  return packages;
}

/* --------------------------------- output --------------------------------- */

function dedupe(packages) {
  const map = new Map();
  for (const pkg of packages) {
    const key = `${pkg.ecosystem}:${pkg.name}@${pkg.version}`;
    if (!map.has(key)) map.set(key, pkg);
  }
  return [...map.values()].sort(
    (a, b) =>
      a.ecosystem.localeCompare(b.ecosystem) ||
      a.name.localeCompare(b.name) ||
      a.version.localeCompare(b.version),
  );
}

function applyOverrides(packages) {
  const overrides = readJson(overridesPath);
  const used = new Set();
  for (const pkg of packages) {
    const key = `${pkg.ecosystem}:${pkg.name}`;
    const override = overrides[key];
    if (!override) continue;
    used.add(key);
    if (override.license) pkg.license = override.license;
  }
  const stale = Object.keys(overrides).filter((key) => !used.has(key));
  return stale;
}

function loadTemplates() {
  /** @type {Map<string, string>} */
  const templates = new Map();
  for (const file of fs.readdirSync(templatesDir)) {
    if (!file.endsWith(".txt")) continue;
    templates.set(
      file.slice(0, -4),
      fs.readFileSync(path.join(templatesDir, file), "utf8").trim(),
    );
  }
  return templates;
}

const SOURCE_NOTICE = `Source code
-----------
Spiral is free and open source: https://github.com/brpowell/spiral

The MP3 encoder (LAME 3.100, LGPL-3.0) is statically linked through the
mp3lame-sys crate, which vendors the LAME source. Because the complete source of
Spiral is public, the LAME library can be replaced with a modified version and
the application rebuilt. The Symphonia crates and the other Mozilla Public
License 2.0 components are used unmodified; their source is available from
crates.io under the package names and versions listed below.`;

/**
 * @param {BundlePackage[]} packages
 * @param {ReturnType<typeof buildGroups>["groups"]} groups
 * @param {string} generatedAt
 */
function formatNoticeText(packages, groups, generatedAt) {
  const lines = [
    "Spiral — third-party open-source notices",
    "",
    "Spiral includes the open-source software listed below. This file reproduces",
    "each distinct license text once, with the packages that use it and their",
    "copyright notices. The same information is shown in the app under",
    "About Spiral -> Licenses.",
    "",
    `Generated: ${generatedAt}`,
    "",
    SOURCE_NOTICE,
    "",
    "Package inventory",
    "-----------------",
    "",
  ];

  for (const ecosystem of /** @type {const} */ (["npm", "cargo"])) {
    const group = packages.filter((p) => p.ecosystem === ecosystem);
    if (group.length === 0) continue;
    lines.push(
      `=== ${ecosystem === "npm" ? "npm" : "Cargo"} (${group.length}) ===`,
      "",
    );
    for (const pkg of group)
      lines.push(`${pkg.name}@${pkg.version} — ${pkg.license}`);
    lines.push("");
  }

  lines.push("License texts", "-------------", "", renderGroups(groups));
  return `${lines.join("\n").trimEnd()}\n`;
}

/** Ignore the Generated timestamp so --check does not fail on a date-only drift. */
function normalizeNotice(text) {
  return text.replace(/^Generated: .+$/m, "Generated:");
}

function parseArgs(argv) {
  let check = false;
  for (const arg of argv) {
    if (arg === "--check") {
      check = true;
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      console.log(`Generate the third-party license bundle from production npm + Cargo deps.

Usage:
  npm run notice:generate
  npm run notice:check
`);
      process.exit(0);
    }
    console.error(`Unknown argument: ${arg}`);
    process.exit(1);
  }
  return { check };
}

function failStale(rels) {
  console.error(`${rels.join(" and ")} ${rels.length > 1 ? "are" : "is"} out of date with the current production npm and Cargo graph.

Regenerate and stage the result:

  npm run notice:generate
  git add ${rels.join(" ")}

Skim the diff for new GPL, AGPL, or other copyleft licenses before committing.`);
  process.exit(1);
}

/**
 * The fdk-aac crates are MIT, but they build the Fraunhofer C library, whose own
 * license is what has to be reproduced. It lives in the app's assets, so it is
 * added to the list like any other license rather than shown separately.
 * @param {import("./lib/license-bundle.mjs").LicenseGroup[]} groups
 * @param {import("./lib/license-bundle.mjs").BundlePackage[]} packages
 */
function addFdkGroup(groups, packages) {
  const lib = packages.find(
    (pkg) => pkg.ecosystem === "cargo" && pkg.name === "fdk-aac-sys",
  );
  if (!lib) return;
  groups.push({
    id: "fraunhofer-fdk-aac-license",
    title: "Fraunhofer FDK AAC Codec License",
    kind: "license",
    text: fs.readFileSync(fdkNoticePath, "utf8").trim(),
    packages: [
      {
        name: lib.name,
        version: lib.version,
        ecosystem: "cargo",
        copyright: [
          "Copyright 1995 - 2018 Fraunhofer-Gesellschaft zur Förderung der angewandten Forschung e.V.",
        ],
        synthesized: false,
      },
    ],
  });
  groups.sort(
    (a, b) =>
      (a.kind === b.kind ? 0 : a.kind === "license" ? -1 : 1) ||
      b.packages.length - a.packages.length ||
      a.title.localeCompare(b.title),
  );
}

function main() {
  const { check } = parseArgs(process.argv.slice(2));
  const packages = dedupe([
    ...collectNpmPackages(),
    ...collectCargoPackages(),
  ]).filter((pkg) => !isIgnored(pkg.name, pkg.ecosystem));

  const staleOverrides = applyOverrides(packages);
  if (staleOverrides.length > 0) {
    console.error(
      `scripts/license-overrides.json has entries for packages that are no longer shipped: ${staleOverrides.join(", ")}`,
    );
    process.exit(1);
  }

  const { groups, unresolved } = buildGroups(packages, loadTemplates());
  addFdkGroup(groups, packages);
  if (unresolved.length > 0) {
    console.error(
      `Could not find a license text for ${unresolved.length} package(s):\n`,
    );
    for (const line of unresolved) console.error(`  ${line}`);
    console.error(`
Add a canonical text to scripts/license-templates/<SPDX-id>.txt, or correct the
package's license in scripts/license-overrides.json.`);
    process.exit(1);
  }

  const text = formatNoticeText(packages, groups, new Date().toISOString());
  const uiJson = `${JSON.stringify(toUiData(groups))}\n`;
  const rel = path.relative(root, outPath);
  const uiRel = path.relative(root, uiOutPath);

  if (check) {
    const stale = [];
    if (
      !fs.existsSync(outPath) ||
      normalizeNotice(fs.readFileSync(outPath, "utf8")) !==
        normalizeNotice(text)
    ) {
      stale.push(rel);
    }
    if (
      !fs.existsSync(uiOutPath) ||
      fs.readFileSync(uiOutPath, "utf8") !== uiJson
    ) {
      stale.push(uiRel);
    }
    if (stale.length > 0) failStale([rel, uiRel]);
    console.log(
      `${rel} and ${uiRel} are up to date (${packages.length} packages, ${groups.length} license texts)`,
    );
    return;
  }

  fs.writeFileSync(outPath, text);
  fs.mkdirSync(path.dirname(uiOutPath), { recursive: true });
  fs.writeFileSync(uiOutPath, uiJson);
  console.log(
    `Wrote ${packages.length} packages in ${groups.length} license texts to ${rel} and ${uiRel}`,
  );
}

main();
