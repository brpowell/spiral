#!/usr/bin/env node
/**
 * Generate a committed production NOTICE file bundled with the app
 * (`src-tauri/NOTICE` → Tauri resources).
 *
 * - npm: production dependencies from package-lock
 * - cargo: packages from `cargo metadata` for the src-tauri package
 *
 * Dev-only tools are excluded. Inventory is name / version / SPDX only.
 * Special notices (LAME, FDK, Symphonia) stay in the About → Licenses UI.
 * First-party packages listed in IGNORE_PACKAGES are omitted.
 *
 * Usage:
 *   node scripts/generate-notice.mjs           # write src-tauri/NOTICE
 *   node scripts/generate-notice.mjs --check   # fail if NOTICE is stale
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outPath = path.join(root, "src-tauri/NOTICE");

/** @typedef {{ name: string, version: string, license: string, ecosystem: 'npm' | 'cargo' }} NoticePackage */

/**
 * First-party packages omitted from NOTICE (this app and sibling Spiral packages).
 *
 * Patterns:
 *   `name`       exact package name in either ecosystem
 *   `eco:name`   exact name in one ecosystem (`npm:` or `cargo:`)
 *   trailing `*` prefix match (`@spiral/*` for the whole npm scope)
 */
const IGNORE_PACKAGES = [
  "@spiral/*",
  "cargo:Spiral",
  "spk-format",
];

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

function collectNpmPackages() {
  /** @type {NoticePackage[]} */
  const packages = [];
  const pkgJson = readJson(path.join(root, "package.json"));
  const lock = readJson(path.join(root, "package-lock.json"));
  const prodNames = new Set(Object.keys(pkgJson.dependencies ?? {}));

  const lockPackages = lock.packages ?? {};
  const rootNode = lockPackages[""] ?? {};
  const rootDeps = {
    ...(rootNode.dependencies ?? {}),
  };

  const visited = new Set();
  /** @type {string[]} */
  const queue = Object.keys(rootDeps);

  while (queue.length > 0) {
    const name = queue.pop();
    if (!name || visited.has(name)) continue;
    visited.add(name);

    const key = `node_modules/${name}`;
    const entry = lockPackages[key];
    if (!entry || entry.dev) continue;

    const version = entry.version ?? "unknown";
    const license =
      entry.license ??
      readPackageLicense(path.join(root, "node_modules", ...name.split("/"))) ??
      "UNKNOWN";
    packages.push({
      name,
      version,
      license: String(license),
      ecosystem: "npm",
    });

    for (const dep of Object.keys(entry.dependencies ?? {})) {
      queue.push(dep);
    }
    for (const dep of Object.keys(entry.optionalDependencies ?? {})) {
      queue.push(dep);
    }
  }

  for (const name of prodNames) {
    if (packages.some((p) => p.name === name)) continue;
    const dir = path.join(root, "node_modules", ...name.split("/"));
    let version = "unknown";
    let license = "UNKNOWN";
    try {
      const meta = readJson(path.join(dir, "package.json"));
      version = meta.version ?? version;
      license = formatNpmLicense(meta.license) ?? license;
    } catch {
      // missing install
    }
    packages.push({
      name,
      version,
      license,
      ecosystem: "npm",
    });
  }

  return packages;
}

function formatNpmLicense(license) {
  if (license == null) return undefined;
  if (typeof license === "string") return license;
  if (typeof license === "object" && license.type) return String(license.type);
  return undefined;
}

function readPackageLicense(dir) {
  try {
    const meta = readJson(path.join(dir, "package.json"));
    return formatNpmLicense(meta.license);
  } catch {
    return undefined;
  }
}

function collectCargoPackages() {
  /** @type {NoticePackage[]} */
  const packages = [];
  const metadata = JSON.parse(
    execFileSync(
      "cargo",
      [
        "metadata",
        "--format-version",
        "1",
        "--manifest-path",
        path.join(root, "src-tauri/Cargo.toml"),
      ],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    ),
  );

  const resolveRoot = metadata.resolve?.root;
  const nodes = new Map(
    (metadata.resolve?.nodes ?? []).map((n) => [n.id, n]),
  );
  const pkgById = new Map(metadata.packages.map((p) => [p.id, p]));

  if (!resolveRoot || nodes.size === 0) {
    for (const pkg of metadata.packages) {
      packages.push({
        name: pkg.name,
        version: pkg.version,
        license: pkg.license ?? "UNKNOWN",
        ecosystem: "cargo",
      });
    }
    return packages;
  }

  const visited = new Set();
  /** @type {string[]} */
  const queue = [resolveRoot];

  while (queue.length > 0) {
    const id = queue.pop();
    if (!id || visited.has(id)) continue;
    visited.add(id);
    const node = nodes.get(id);
    const pkg = pkgById.get(id);
    if (!pkg) continue;

    packages.push({
      name: pkg.name,
      version: pkg.version,
      license: pkg.license ?? "UNKNOWN",
      ecosystem: "cargo",
    });

    for (const dep of node?.deps ?? []) {
      queue.push(dep.pkg);
    }
  }

  return packages;
}

function dedupe(packages) {
  const map = new Map();
  for (const pkg of packages) {
    const key = `${pkg.ecosystem}:${pkg.name}@${pkg.version}`;
    if (!map.has(key)) map.set(key, pkg);
  }
  return [...map.values()].sort((a, b) => {
    if (a.ecosystem !== b.ecosystem) {
      return a.ecosystem.localeCompare(b.ecosystem);
    }
    return a.name.localeCompare(b.name) || a.version.localeCompare(b.version);
  });
}

/**
 * @param {NoticePackage[]} packages
 * @param {string} generatedAt
 */
function formatNoticeText(packages, generatedAt) {
  const lines = [
    "Spiral — third-party open-source notices",
    "",
    "This file lists production npm packages and Rust crates shipped with Spiral,",
    "with SPDX license identifiers. Special notices (LAME / LGPL, Fraunhofer FDK AAC,",
    "Symphonia / MPL) are also shown in the app under About Spiral → Licenses.",
    "",
    `Generated: ${generatedAt}`,
    "",
  ];

  /** @type {Array<'npm' | 'cargo'>} */
  const ecosystems = ["npm", "cargo"];
  for (const ecosystem of ecosystems) {
    const group = packages.filter((p) => p.ecosystem === ecosystem);
    if (group.length === 0) continue;
    lines.push(
      `=== ${ecosystem === "npm" ? "npm" : "Cargo"} (${group.length}) ===`,
      "",
    );
    for (const pkg of group) {
      lines.push(`${pkg.name}@${pkg.version} — ${pkg.license}`);
    }
    lines.push("");
  }

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
      console.log(`Generate src-tauri/NOTICE from production npm + Cargo deps.

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

function failStale() {
  const rel = path.relative(root, outPath);
  console.error(`${rel} is out of date with the current production npm and Cargo graph.

Regenerate it and stage the result:

  npm run notice:generate
  git add ${rel}

Skim the diff for new GPL, AGPL, or other copyleft licenses before committing.`);
  process.exit(1);
}

function main() {
  const { check } = parseArgs(process.argv.slice(2));
  const packages = dedupe([
    ...collectNpmPackages(),
    ...collectCargoPackages(),
  ]).filter((pkg) => !isIgnored(pkg.name, pkg.ecosystem));
  const generatedAt = new Date().toISOString();
  const text = formatNoticeText(packages, generatedAt);
  const rel = path.relative(root, outPath);

  if (check) {
    if (!fs.existsSync(outPath)) {
      failStale();
    }
    const existing = fs.readFileSync(outPath, "utf8");
    if (normalizeNotice(existing) !== normalizeNotice(text)) {
      failStale();
    }
    console.log(`${rel} is up to date (${packages.length} packages)`);
    return;
  }

  fs.writeFileSync(outPath, text);
  console.log(`Wrote ${packages.length} packages to ${rel}`);
}

main();
