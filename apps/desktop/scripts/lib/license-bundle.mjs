/**
 * Pure logic for the third-party license bundle: SPDX expression handling,
 * license-text parsing, grouping, and rendering. No I/O, so it can be unit
 * tested. `scripts/generate-notice.mjs` does the file and process work.
 *
 * Why this exists: MIT, BSD, Apache, ISC and similar licenses require that the
 * copyright notice and license text travel with the binary. A list of names and
 * SPDX ids is not enough. About 800 packages share only a handful of license
 * texts, so the bundle stores each distinct text once and lists the packages
 * (with their own copyright lines) that use it.
 */
import { createHash } from "node:crypto";

/**
 * @typedef {{ kind: 'license' | 'notice', name: string, text: string }} LicenseFile
 * @typedef {{
 *   name: string, version: string, ecosystem: 'npm' | 'cargo', license: string,
 *   authors?: string[], repository?: string, files: LicenseFile[]
 * }} BundlePackage
 * @typedef {{
 *   name: string, version: string, ecosystem: 'npm' | 'cargo',
 *   copyright: string[], synthesized: boolean
 * }} GroupMember
 * @typedef {{
 *   id: string, title: string, kind: 'license' | 'notice', text: string,
 *   packages: GroupMember[]
 * }} LicenseGroup
 */

/* ------------------------------ SPDX ------------------------------ */

/**
 * Parse an SPDX-ish expression into a tree. Handles `AND`, `OR`, `WITH`,
 * parentheses, and the legacy `/` separator used by older crates (`MIT/Apache-2.0`).
 * @param {string} expression
 * @returns {{ op: 'id', id: string } | { op: 'and' | 'or', terms: any[] }}
 */
export function parseSpdx(expression) {
  const tokens = expression
    .replace(/\(/g, " ( ")
    .replace(/\)/g, " ) ")
    .replace(/\//g, " OR ")
    .split(/\s+/)
    .filter(Boolean);
  let pos = 0;

  function parseOr() {
    const terms = [parseAnd()];
    while (tokens[pos]?.toUpperCase() === "OR") {
      pos += 1;
      terms.push(parseAnd());
    }
    return terms.length === 1 ? terms[0] : { op: "or", terms };
  }

  function parseAnd() {
    const terms = [parseAtom()];
    while (tokens[pos]?.toUpperCase() === "AND") {
      pos += 1;
      terms.push(parseAtom());
    }
    return terms.length === 1 ? terms[0] : { op: "and", terms };
  }

  function parseAtom() {
    const token = tokens[pos];
    if (token === undefined)
      throw new Error(`Bad SPDX expression: ${expression}`);
    pos += 1;
    if (token === "(") {
      const inner = parseOr();
      if (tokens[pos] !== ")")
        throw new Error(`Bad SPDX expression: ${expression}`);
      pos += 1;
      return inner;
    }
    // `X WITH Exception` is the license X for our purposes.
    if (tokens[pos]?.toUpperCase() === "WITH") pos += 2;
    return { op: "id", id: token };
  }

  const tree = parseOr();
  if (pos !== tokens.length)
    throw new Error(`Bad SPDX expression: ${expression}`);
  return tree;
}

/** When a package offers a choice (`OR`), prefer these, in order. */
export const LICENSE_PREFERENCE = [
  "MIT",
  "Apache-2.0",
  "BSD-3-Clause",
  "BSD-2-Clause",
  "ISC",
  "Zlib",
  "Unicode-3.0",
  "0BSD",
  "Unlicense",
  "CC0-1.0",
  "MPL-2.0",
];

/**
 * The license ids that must be reproduced for an expression: every `AND` term,
 * and one preferred alternative of each `OR`.
 * @param {string} expression
 * @param {Iterable<string>} [available] ids we have a template for (preferred when choosing)
 * @returns {string[]}
 */
export function licensesToReproduce(expression, available = []) {
  const have = new Set(available);
  const pick = (node) => {
    if (node.op === "id") return [node.id];
    if (node.op === "and") return node.terms.flatMap(pick);
    const options = node.terms.map(pick);
    const rank = (ids) => {
      const ranks = ids.map((id) => {
        const r = LICENSE_PREFERENCE.indexOf(id);
        return r === -1 ? LICENSE_PREFERENCE.length : r;
      });
      return Math.max(...ranks) + (ids.every((id) => have.has(id)) ? 0 : 100);
    };
    return [...options].sort((a, b) => rank(a) - rank(b))[0];
  };
  return [...new Set(pick(parseSpdx(expression)))];
}

/* ------------------------- license text parsing ------------------------- */

const COPYRIGHT_LINE = /^\s*(copyright\b|©|\(c\)\s)/i;
const ALL_RIGHTS_RESERVED = /^\s*all rights reserved\.?\s*$/i;
// Placeholders in a license template, not a real copyright line. An email in
// angle brackets after a name is NOT a placeholder.
const TEMPLATE_MARKER =
  /yyyy|[[<{]\s*(year|name|copyright|owner|holder|author)/i;
const TITLE_LINE =
  /^[\s#/*;(=-]*(the\s+)?(mit|bsd|isc|zlib|apache|mozilla|unicode|boost)\b[^.]{0,60}licen[sc]e[^.]{0,30}$/i;

/**
 * Split a license file into the package's own copyright lines and the license
 * body, so the same license text groups together across packages whose only
 * difference is the copyright holder. Template placeholders such as the Apache
 * appendix's "Copyright [yyyy] [name of copyright owner]" stay in the body.
 * @param {string} text
 * @returns {{ copyright: string[], body: string }}
 */
export function splitCopyright(text) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const copyright = [];
  const body = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (COPYRIGHT_LINE.test(line) && !TEMPLATE_MARKER.test(line)) {
      copyright.push(line.trim().replace(/\s+/g, " "));
      if (ALL_RIGHTS_RESERVED.test(lines[i + 1] ?? "")) i += 1;
      continue;
    }
    body.push(line);
  }
  return { copyright, body: body.join("\n").trim() };
}

/** Lowercase, straight quotes, single spaces. Keeps titles and URLs. */
function lightNormalize(text) {
  return text
    .replace(/^[ \t]*(\/\/+|\/?\*+|#+(?= )|;+)[ \t]?/gm, "")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Canonical form used only to decide whether two license texts are the same:
 * ignores a leading title, URLs, quote style, line wrapping, trailing
 * punctuation, and the Apache-2.0 optional appendix (boilerplate that is not
 * part of the license terms).
 * @param {string} body
 */
export function normalizeBody(body) {
  const lines = body.split("\n");
  // A leading title line ("The MIT License (MIT)") varies between packages.
  while (
    lines.length > 0 &&
    (lines[0].trim() === "" || TITLE_LINE.test(lines[0]))
  ) {
    lines.shift();
  }
  let t = lightNormalize(lines.join("\n"))
    .replace(/^[=\-\s]+/, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s+/g, " ")
    .replace(/"/g, "'");
  const apacheEnd = t.indexOf("end of terms and conditions");
  if (apacheEnd !== -1)
    t = t.slice(0, apacheEnd + "end of terms and conditions".length);
  return t.replace(/[.\s]+$/, "");
}

/**
 * Human title for a license body, from its recognisable wording.
 * @param {string} body
 * @param {string} [fallback]
 */
export function titleForBody(body, fallback = "License") {
  const t = lightNormalize(body);
  if (t.includes("apache license") && t.includes("version 2.0")) {
    return t.includes("llvm exceptions")
      ? "Apache License 2.0 with LLVM exception"
      : "Apache License 2.0";
  }
  if (t.includes("mozilla public license") && t.includes("version 2.0"))
    return "Mozilla Public License 2.0";
  if (t.includes("gnu lesser general public license"))
    return "GNU Lesser General Public License";
  if (t.includes("unicode license") || t.includes("unicode, inc."))
    return "Unicode License v3";
  if (t.includes("permission is hereby granted, free of charge"))
    return "MIT License";
  if (t.includes("redistribution and use in source and binary forms")) {
    return t.includes("neither the name")
      ? "BSD 3-Clause License"
      : "BSD 2-Clause License";
  }
  if (
    t.includes(
      "permission to use, copy, modify, and/or distribute this software for any purpose with or without fee",
    )
  ) {
    return t.includes("provided that the above copyright notice")
      ? "ISC License"
      : "BSD Zero Clause License";
  }
  if (
    t.includes("this software is provided 'as-is'") ||
    t.includes('this software is provided "as-is"')
  )
    return "zlib License";
  if (t.includes("unencumbered software released into the public domain"))
    return "The Unlicense";
  if (
    t.includes("cc0 1.0 universal") ||
    t.includes("creative commons legal code")
  )
    return "Creative Commons CC0 1.0";
  if (t.includes("boost software license")) return "Boost Software License 1.0";
  return fallback;
}

/* ------------------------------- grouping ------------------------------- */

/** Anything shorter than this that we cannot recognise is a pointer, not a license. */
const MIN_UNRECOGNISED_LICENSE_CHARS = 400;

/**
 * Some packages ship a LICENSE file that only says "MIT OR Apache-2.0" or "this
 * project is dual-licensed under ...". That points at a license; it is not one.
 * @param {string} text
 */
export function isLicenseText(text) {
  const { body } = splitCopyright(text);
  if (titleForBody(body, "") !== "") return true;
  return lightNormalize(body).length >= MIN_UNRECOGNISED_LICENSE_CHARS;
}

/**
 * @param {string} spdxId
 * @param {Map<string, string>} templates SPDX id -> license body
 * @returns {LicenseFile | undefined}
 */
function synthesizeFile(spdxId, templates) {
  const text = templates.get(spdxId);
  return text === undefined
    ? undefined
    : { kind: "license", name: `${spdxId} (canonical text)`, text };
}

/**
 * @param {BundlePackage} pkg
 * @returns {string}
 */
function authorsLine(pkg) {
  const authors = (pkg.authors ?? [])
    .map((a) => a.replace(/\s*<[^>]*>/, "").trim())
    .filter(Boolean);
  return authors.length > 0
    ? `Authors (from package metadata): ${authors.join(", ")}`
    : undefined;
}

/**
 * @param {BundlePackage} pkg
 * @returns {string}
 */
function fallbackCopyright(pkg) {
  return (
    authorsLine(pkg) ??
    `Copyright held by the authors of ${pkg.name}${pkg.repository ? ` (${pkg.repository})` : ""}`
  );
}

/**
 * Group packages by distinct license text.
 * @param {BundlePackage[]} packages
 * @param {Map<string, string>} templates SPDX id -> canonical body, used when a
 *   package ships no license file
 * @returns {{ groups: LicenseGroup[], unresolved: string[] }}
 */
export function buildGroups(packages, templates) {
  /** @type {Map<string, LicenseGroup>} */
  const groups = new Map();
  const unresolved = [];

  const add = (kind, rawText, member, fallbackTitle) => {
    const { copyright, body } = splitCopyright(rawText);
    const key = `${kind}:${normalizeBody(body)}`;
    let group = groups.get(key);
    if (!group) {
      const title =
        kind === "notice"
          ? "Notices (NOTICE files)"
          : titleForBody(body, fallbackTitle);
      group = {
        id: `${title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(
            /^-|-$/g,
            "",
          )}-${createHash("sha1").update(key).digest("hex").slice(0, 6)}`,
        title,
        kind,
        text: body,
        packages: [],
      };
      groups.set(key, group);
    }
    const existing = group.packages.find(
      (p) =>
        p.ecosystem === member.ecosystem &&
        p.name === member.name &&
        p.version === member.version,
    );
    const lines = member.synthesized
      ? [member.copyrightFallback]
      : copyright.length > 0
        ? copyright
        : member.authorsLine
          ? [member.authorsLine]
          : [];
    if (existing) {
      for (const line of lines)
        if (!existing.copyright.includes(line)) existing.copyright.push(line);
    } else {
      group.packages.push({
        name: member.name,
        version: member.version,
        ecosystem: member.ecosystem,
        copyright: [...lines],
        synthesized: member.synthesized,
      });
    }
  };

  for (const pkg of packages) {
    const member = {
      name: pkg.name,
      version: pkg.version,
      ecosystem: pkg.ecosystem,
      synthesized: false,
      authorsLine: authorsLine(pkg),
    };
    const licenseFiles = pkg.files.filter(
      (f) => f.kind === "license" && isLicenseText(f.text),
    );
    const noticeFiles = pkg.files.filter((f) => f.kind === "notice");

    for (const file of noticeFiles) add("notice", file.text, member, "Notices");

    if (licenseFiles.length > 0) {
      for (const file of licenseFiles)
        add("license", file.text, member, pkg.license);
      continue;
    }

    // No license file in the package: reproduce the canonical text of the
    // license it declares, with the manifest's authors as the copyright holder.
    let ids;
    try {
      ids = licensesToReproduce(pkg.license, templates.keys());
    } catch {
      unresolved.push(
        `${pkg.ecosystem}:${pkg.name}@${pkg.version} (unparseable license "${pkg.license}")`,
      );
      continue;
    }
    const files = ids.map((id) => synthesizeFile(id, templates));
    if (files.length === 0 || files.some((f) => f === undefined)) {
      const missing = ids.filter((id) => !templates.has(id));
      unresolved.push(
        `${pkg.ecosystem}:${pkg.name}@${pkg.version} (${pkg.license}): no license file in the package and no template for ${missing.join(", ")}`,
      );
      continue;
    }
    const synthMember = {
      ...member,
      synthesized: true,
      copyrightFallback: fallbackCopyright(pkg),
    };
    for (const file of files)
      add("license", file.text, synthMember, pkg.license);
  }

  const list = [...groups.values()];
  for (const group of list) {
    group.packages.sort(
      (a, b) =>
        a.ecosystem.localeCompare(b.ecosystem) ||
        a.name.localeCompare(b.name) ||
        a.version.localeCompare(b.version),
    );
  }
  list.sort(
    (a, b) =>
      (a.kind === b.kind ? 0 : a.kind === "license" ? -1 : 1) ||
      b.packages.length - a.packages.length ||
      a.title.localeCompare(b.title),
  );
  return { groups: list, unresolved: unresolved.sort() };
}

/* ------------------------------- rendering ------------------------------- */

const RULE = "=".repeat(78);
const THIN = "-".repeat(78);

/**
 * @param {LicenseGroup[]} groups
 */
export function renderGroups(groups) {
  const out = [];
  for (const group of groups) {
    out.push(
      RULE,
      `${group.title} — used by ${group.packages.length} package${group.packages.length === 1 ? "" : "s"}`,
      RULE,
      "",
    );
    for (const pkg of group.packages) {
      out.push(`${pkg.name}@${pkg.version} (${pkg.ecosystem})`);
      for (const line of pkg.copyright) out.push(`    ${line}`);
    }
    out.push("", THIN, "", group.text, "");
  }
  return out.join("\n");
}

/**
 * Data the About window renders. Contains no timestamp so it is stable for the
 * `--check` comparison.
 * @param {LicenseGroup[]} groups
 */
export function toUiData(groups) {
  const names = new Set();
  for (const group of groups) {
    for (const p of group.packages)
      names.add(`${p.ecosystem}:${p.name}@${p.version}`);
  }
  return { packageCount: names.size, groups };
}
