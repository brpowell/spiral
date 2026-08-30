#!/usr/bin/env node
/**
 * Fail if `t("ns:key")` / `i18n.t("ns:key")` / `tUnchecked("ns:key")`
 * references a key missing from `src/locales/en/*.json`.
 *
 * Plural call sites use the unsuffixed key (`toasts:queue.added`); catalogs
 * store `added_one` / `added_other`. Both forms are treated as present.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const LOCALES_EN = path.join(ROOT, "src/locales/en");
const SRC = path.join(ROOT, "src");

const PLURAL_SUFFIXES = ["zero", "one", "two", "few", "many", "other"];
const KEY_CALL_RE = /\b(?:t|tUnchecked|i18n\.t)\(\s*(['"])((?:\\.|[^\\])*?)\1/g;
const USE_TRANSLATION_RE = /useTranslation\(\s*(['"])([^'"]+)\1/g;
const USE_TRANSLATION_ARRAY_RE = /useTranslation\(\s*\[([^\]]*)\]/g;
const SKIP_DIRS = new Set(["locales"]);

function walkJson(value, prefix, out) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      const next = prefix ? `${prefix}.${key}` : key;
      walkJson(child, next, out);
    }
    return;
  }
  out.add(prefix);
}

function addPluralBases(keys) {
  for (const key of [...keys]) {
    for (const suffix of PLURAL_SUFFIXES) {
      const ending = `_${suffix}`;
      if (key.endsWith(ending)) {
        keys.add(key.slice(0, -ending.length));
      }
    }
  }
}

function loadEnglishCatalogs() {
  const catalogs = new Map();
  for (const file of fs.readdirSync(LOCALES_EN).sort()) {
    if (!file.endsWith(".json")) continue;
    const ns = file.slice(0, -".json".length);
    const keys = new Set();
    walkJson(
      JSON.parse(fs.readFileSync(path.join(LOCALES_EN, file), "utf8")),
      "",
      keys,
    );
    addPluralBases(keys);
    catalogs.set(ns, keys);
  }
  return catalogs;
}

function walkSourceFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walkSourceFiles(full, out);
      continue;
    }
    if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

function fileHookNamespaces(text) {
  const namespaces = new Set();
  USE_TRANSLATION_RE.lastIndex = 0;
  for (const match of text.matchAll(USE_TRANSLATION_RE)) {
    namespaces.add(match[2]);
  }
  USE_TRANSLATION_ARRAY_RE.lastIndex = 0;
  for (const match of text.matchAll(USE_TRANSLATION_ARRAY_RE)) {
    for (const ns of match[1].matchAll(/['"]([^'"]+)['"]/g)) {
      namespaces.add(ns[1]);
    }
  }
  return namespaces;
}

function extractUsedKeys(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  const used = [];
  KEY_CALL_RE.lastIndex = 0;
  for (const match of text.matchAll(KEY_CALL_RE)) {
    const raw = match[2].replace(/\\'/g, "'").replace(/\\"/g, '"');
    if (!raw || raw.includes("${")) continue;
    used.push(raw);
  }
  return { used, hookNamespaces: fileHookNamespaces(text) };
}

function splitKey(raw, hookNamespaces) {
  const sep = raw.indexOf(":");
  if (sep !== -1) {
    return [{ ns: raw.slice(0, sep), key: raw.slice(sep + 1) }];
  }
  const namespaces =
    hookNamespaces.size > 0 ? hookNamespaces : new Set(["common"]);
  return [...namespaces].map((ns) => ({ ns, key: raw }));
}

const catalogs = loadEnglishCatalogs();
const missing = [];
const unknownNs = [];

for (const file of walkSourceFiles(SRC)) {
  const rel = path.relative(ROOT, file);
  const { used, hookNamespaces } = extractUsedKeys(file);
  for (const raw of used) {
    const candidates = splitKey(raw, hookNamespaces);
    const unknown = candidates.filter(({ ns }) => !catalogs.has(ns));
    if (unknown.length === candidates.length) {
      unknownNs.push({ file: rel, raw, ns: unknown[0]?.ns ?? "?" });
      continue;
    }
    const found = candidates.some(({ ns, key }) => catalogs.get(ns)?.has(key));
    if (!found) {
      missing.push({ file: rel, raw });
    }
  }
}

if (unknownNs.length > 0 || missing.length > 0) {
  if (unknownNs.length > 0) {
    console.error("Unknown i18n namespaces:");
    for (const row of unknownNs) {
      console.error(`  ${row.file}: ${row.raw} (ns "${row.ns}")`);
    }
  }
  if (missing.length > 0) {
    console.error("Missing i18n keys:");
    for (const row of missing) {
      console.error(`  ${row.file}: ${row.raw}`);
    }
  }
  process.exit(1);
}

const keyCount = [...catalogs.values()].reduce((sum, set) => sum + set.size, 0);
console.log(
  `i18n keys ok (${catalogs.size} namespaces, ${keyCount} catalog paths).`,
);
