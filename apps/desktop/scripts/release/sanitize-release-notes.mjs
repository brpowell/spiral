#!/usr/bin/env node
/**
 * Rewrite a release-please changelog blob into user-facing GitHub Release notes.
 *
 * Used after release-please creates a draft (CI) and for operator backfill:
 *   npm run release -- sanitize-notes <tag>
 *   npm run release -- sanitize-notes <tag> --dry-run
 *
 * CHANGELOG.md is never written. The sanitizer is a pure function; `gh` is
 * only for the tag CLI (view body → edit notes).
 *
 * Requires `gh` authenticated with contents:write when rewriting a tag.
 * `--dry-run` only needs read (prints sanitized notes to stdout).
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Headings users see. Match release-please section titles, not commit types. */
const USER_FACING_HEADINGS = new Set(["Features", "Bug Fixes"]);

/** Publisher-replaceable body when a release is only hidden-type commits. */
export const EMPTY_NOTES_FALLBACK = "Maintenance release.";

const TRAILING_PR_LINK_RE = /\s+\(\[#\d+\]\([^)]+\)\)\s*$/;
const TRAILING_SHA_LINK_RE = /\s+\(\[[0-9a-f]{7,40}\]\([^)]+\)\)\s*$/i;

/**
 * Drop ` ([#N](url))` and ` ([sha](url))` groups from the end of a line.
 * Idempotent: already-cleaned lines are unchanged.
 *
 * @param {string} line
 * @returns {string}
 */
export function stripTrailingPrAndCommitLinks(line) {
  let current = line;
  for (;;) {
    const next = current
      .replace(TRAILING_PR_LINK_RE, "")
      .replace(TRAILING_SHA_LINK_RE, "");
    if (next === current) return current.trimEnd();
    current = next;
  }
}

/**
 * @param {string} markdown
 * @returns {string}
 */
function dropVersionHeaders(markdown) {
  // Built per call: a module-level `/g` regex would leak lastIndex across
  // sanitizeReleaseNotes invocations.
  return markdown.replace(
    /^## \[[^\]]+\]\([^)]*\)(?: \([^)]+\))?[ \t]*(?:\r?\n|$)/gm,
    "",
  );
}

/**
 * @param {string} markdown
 * @returns {{ heading: string, body: string }[]}
 */
function parseH3Sections(markdown) {
  const lines = markdown.split(/\n/);
  /** @type {{ heading: string, body: string }[]} */
  const sections = [];
  /** @type {{ heading: string, lines: string[] } | null} */
  let current = null;

  const flush = () => {
    if (!current) return;
    sections.push({
      heading: current.heading,
      body: current.lines.join("\n"),
    });
    current = null;
  };

  for (const line of lines) {
    const match = line.match(/^###[ \t]+(.+?)[ \t]*$/);
    if (match) {
      flush();
      current = { heading: match[1].trim(), lines: [] };
      continue;
    }
    if (current) current.lines.push(line);
  }
  flush();
  return sections;
}

/**
 * @param {string} body
 * @returns {string}
 */
function sanitizeSectionBody(body) {
  return body
    .split("\n")
    .map((line) => stripTrailingPrAndCommitLinks(line))
    .join("\n")
    .trim();
}

/**
 * Changelog-style markdown in → user-facing markdown out.
 *
 * @param {string} markdown
 * @returns {string} Canonical notes, always trailing-newline terminated.
 */
export function sanitizeReleaseNotes(markdown) {
  const normalized = String(markdown ?? "").replace(/\r\n/g, "\n");
  // Already summarized (see summarize-release-notes.mjs): rewriting would drop
  // the summary and the collapsed line items.
  if (/<details[\s>]/i.test(normalized)) {
    return `${normalized.trim()}\n`;
  }
  const withoutHeaders = dropVersionHeaders(normalized);
  const hadVersionHeader = withoutHeaders !== normalized;

  const sections = parseH3Sections(withoutHeaders);
  const kept = [];
  for (const section of sections) {
    if (!USER_FACING_HEADINGS.has(section.heading)) continue;
    const body = sanitizeSectionBody(section.body);
    if (body.length === 0) continue;
    kept.push(`### ${section.heading}\n\n${body}`);
  }

  if (kept.length > 0) {
    return `${kept.join("\n\n")}\n`;
  }

  const hadDroppedSections = sections.some(
    (section) => !USER_FACING_HEADINGS.has(section.heading),
  );
  if (hadDroppedSections || hadVersionHeader) {
    return `${EMPTY_NOTES_FALLBACK}\n`;
  }

  const leftover = withoutHeaders.trim();
  return leftover.length > 0 ? `${leftover}\n` : `${EMPTY_NOTES_FALLBACK}\n`;
}

function usage(exitCode = 0) {
  console.log(`Sanitize a GitHub Release body for What's New.

Usage:
  npm run release -- sanitize-notes <tag>
  npm run release -- sanitize-notes <tag> --dry-run

Options:
  --dry-run, -n   Print sanitized notes to stdout; do not edit the release

Examples:
  npm run release -- sanitize-notes desktop-v0.2.0
  npm run release -- sanitize-notes desktop-v0.2.0 --dry-run

Rewrites the release notes in place. CHANGELOG.md is not touched.
Safe to re-run: already-cleaned notes, and notes that already carry an
AI-written summary, are left unchanged.
`);
  process.exit(exitCode);
}

/**
 * @param {string[]} argv
 * @returns {{ help: true } | { error: string } | { tag: string, dryRun: boolean }}
 */
export function parseSanitizeNotesCli(argv) {
  let dryRun = false;
  /** @type {string[]} */
  const positional = [];
  for (const arg of argv) {
    if (arg === "-h" || arg === "--help") return { help: true };
    if (arg === "--dry-run" || arg === "-n") {
      dryRun = true;
      continue;
    }
    if (arg.startsWith("-")) return { error: `Unknown option: ${arg}` };
    positional.push(arg);
  }
  if (positional.length > 1) {
    return { error: `Unexpected argument: ${positional[1]}` };
  }
  return { tag: positional[0], dryRun };
}

export function ghJson(args) {
  const result = spawnSync("gh", args, { encoding: "utf8" });
  if (result.error) {
    throw new Error(result.error.message);
  }
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "").trim());
  }
  return JSON.parse(result.stdout);
}

export function repoArgs() {
  const repo = process.env.GITHUB_REPOSITORY;
  return repo ? ["--repo", repo] : [];
}

function rewriteTagNotes(tag, { dryRun } = {}) {
  const extra = repoArgs();
  let release;
  try {
    release = ghJson(["release", "view", tag, "--json", "body,url", ...extra]);
  } catch (err) {
    console.error(`Could not load release ${tag}: ${err.message}`);
    process.exit(1);
  }

  const current = release.body ?? "";
  const sanitized = sanitizeReleaseNotes(current);
  if (dryRun) {
    process.stdout.write(sanitized);
    return;
  }

  if (sanitized === current || sanitized === `${current.trim()}\n`) {
    console.log(`Notes for ${tag} already sanitized; no change.`);
    console.log(release.url);
    return;
  }

  const edit = spawnSync(
    "gh",
    ["release", "edit", tag, "--notes-file", "-", ...extra],
    {
      encoding: "utf8",
      input: sanitized,
      stdio: ["pipe", "inherit", "inherit"],
    },
  );
  if (edit.error) {
    console.error(edit.error.message);
    process.exit(1);
  }
  if (edit.status !== 0) {
    process.exit(edit.status ?? 1);
  }
  console.log(`Sanitized notes for ${tag}.`);
  console.log(release.url);
}

function main() {
  const parsed = parseSanitizeNotesCli(process.argv.slice(2));
  if ("help" in parsed) usage(0);
  if ("error" in parsed) {
    console.error(parsed.error);
    usage(1);
  }
  const { tag, dryRun } = parsed;
  if (!tag) usage(1);
  if (!/^desktop-v\d+\.\d+\.\d+/.test(tag)) {
    console.error(
      `Expected a desktop release tag like desktop-v0.2.0, got: ${tag}`,
    );
    process.exit(1);
  }
  rewriteTagNotes(tag, { dryRun });
}

const invokedDirectly =
  Boolean(process.argv[1]) &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (invokedDirectly) {
  main();
}
