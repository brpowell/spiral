import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  EMPTY_NOTES_FALLBACK,
  parseSanitizeNotesCli,
  sanitizeReleaseNotes,
  stripTrailingPrAndCommitLinks,
} from "./sanitize-release-notes.mjs";

function changelogSection(version) {
  const changelog = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../../CHANGELOG.md"),
    "utf8",
  );
  const marker = `## [${version}]`;
  const start = changelog.indexOf(marker);
  if (start < 0) {
    throw new Error(`CHANGELOG.md has no ${version} section`);
  }
  const next = changelog.indexOf("\n## [", start + marker.length);
  return changelog.slice(start, next === -1 ? undefined : next);
}

/** Real 0.2.0 section from CHANGELOG.md (release-please shape). */
const CHANGELOG_0_2_0 = changelogSection("0.2.0");

const SANITIZED_0_2_0 = `### Features

* enable custom window chrome on Linux
* global shortcuts and improved file importing
* **i18n:** Phase 1–2 cutoff — scaffold + centralized catalogs
* import tracks to library
* point updater endpoints at spiralpowered.com
* present in-app updates via toast, badge, and prefs
* wire tauri updater

### Bug Fixes

* drag to import
* modal dismiss during text selection
* rapid track switching fails playback
* stop playback when switching library roots
* **updater:** disable live update checks in debug builds
`;

describe("stripTrailingPrAndCommitLinks", () => {
  it("strips a trailing PR + SHA pair", () => {
    expect(
      stripTrailingPrAndCommitLinks(
        "* **deps:** address npm and cargo audit vulnerabilities ([#214](https://github.com/brpowell/spiral-desktop/issues/214)) ([fd87c5d](https://github.com/brpowell/spiral-desktop/commit/fd87c5d0688a8bc5fe0e0e9208ce8a9c89c9b503))",
      ),
    ).toBe("* **deps:** address npm and cargo audit vulnerabilities");
  });

  it("strips a SHA-only trailing group", () => {
    expect(
      stripTrailingPrAndCommitLinks(
        "* drag to import ([1080549](https://github.com/brpowell/spiral-desktop/commit/10805491aea3610ffecc09d2349fc4bbbb2dba21))",
      ),
    ).toBe("* drag to import");
  });

  it("leaves mid-line markdown links alone", () => {
    expect(
      stripTrailingPrAndCommitLinks(
        "* see [#12](https://example.com/12) for context",
      ),
    ).toBe("* see [#12](https://example.com/12) for context");
  });

  it("leaves a trailing non-PR/SHA markdown link alone", () => {
    expect(
      stripTrailingPrAndCommitLinks(
        "* more in the [docs](https://example.com/docs)",
      ),
    ).toBe("* more in the [docs](https://example.com/docs)");
  });
});

describe("sanitizeReleaseNotes", () => {
  it("turns a real CHANGELOG.md section into Features/Bug Fixes only", () => {
    const out = sanitizeReleaseNotes(CHANGELOG_0_2_0);
    expect(out).toBe(SANITIZED_0_2_0);
    expect(out).not.toMatch(/^## /m);
    expect(out).not.toMatch(/\(#[0-9]+\)/);
    expect(out).not.toMatch(/\]\(https:\/\/github\.com\/[^)]+\/commit\//);
  });

  it("drops hidden-type sections and keeps Features / Bug Fixes", () => {
    const input = `## [0.3.0](https://github.com/brpowell/spiral-desktop/compare/v0.2.2...v0.3.0) (2026-08-26)

### Features

* add what's new ([#300](https://github.com/brpowell/spiral-desktop/issues/300)) ([abc1234](https://github.com/brpowell/spiral-desktop/commit/abc1234))

### Bug Fixes

* toast contrast ([#301](https://github.com/brpowell/spiral-desktop/issues/301)) ([def5678](https://github.com/brpowell/spiral-desktop/commit/def5678))

### Performance Improvements

* skip extra paint ([#302](https://github.com/brpowell/spiral-desktop/issues/302)) ([aaa1111](https://github.com/brpowell/spiral-desktop/commit/aaa1111))

### Miscellaneous Chores

* bump ci image ([#303](https://github.com/brpowell/spiral-desktop/issues/303)) ([bbb2222](https://github.com/brpowell/spiral-desktop/commit/bbb2222))

### Tests

* cover sanitizer ([#304](https://github.com/brpowell/spiral-desktop/issues/304)) ([ccc3333](https://github.com/brpowell/spiral-desktop/commit/ccc3333))

### Continuous Integration

* cache rust ([#305](https://github.com/brpowell/spiral-desktop/issues/305)) ([ddd4444](https://github.com/brpowell/spiral-desktop/commit/ddd4444))

### Code Refactoring

* extract helper ([#306](https://github.com/brpowell/spiral-desktop/issues/306)) ([eee5555](https://github.com/brpowell/spiral-desktop/commit/eee5555))

### Build System

* update tauri ([#307](https://github.com/brpowell/spiral-desktop/issues/307)) ([fff6666](https://github.com/brpowell/spiral-desktop/commit/fff6666))

### Documentation

* fix typo ([#308](https://github.com/brpowell/spiral-desktop/issues/308)) ([111aaaa](https://github.com/brpowell/spiral-desktop/commit/111aaaa))

### Dependencies

* bump lodash ([#309](https://github.com/brpowell/spiral-desktop/issues/309)) ([222bbbb](https://github.com/brpowell/spiral-desktop/commit/222bbbb))
`;

    expect(sanitizeReleaseNotes(input)).toBe(`### Features

* add what's new

### Bug Fixes

* toast contrast
`);
  });

  it("returns already-sanitized notes unchanged", () => {
    expect(sanitizeReleaseNotes(SANITIZED_0_2_0)).toBe(SANITIZED_0_2_0);
  });

  it("is idempotent on raw changelog input", () => {
    const once = sanitizeReleaseNotes(CHANGELOG_0_2_0);
    expect(sanitizeReleaseNotes(once)).toBe(once);
  });

  it("does not emit an empty body for chore-only notes", () => {
    const input = `## [0.2.3](https://github.com/brpowell/spiral-desktop/compare/v0.2.2...v0.2.3) (2026-08-26)

### Miscellaneous Chores

* bump actions/checkout ([#310](https://github.com/brpowell/spiral-desktop/issues/310)) ([abc1234](https://github.com/brpowell/spiral-desktop/commit/abc1234))

### Tests

* add a snapshot ([#311](https://github.com/brpowell/spiral-desktop/issues/311)) ([def5678](https://github.com/brpowell/spiral-desktop/commit/def5678))
`;
    const out = sanitizeReleaseNotes(input);
    expect(out).toBe(`${EMPTY_NOTES_FALLBACK}\n`);
    expect(sanitizeReleaseNotes(out)).toBe(out);
  });

  it("falls back when the blob is empty", () => {
    expect(sanitizeReleaseNotes("")).toBe(`${EMPTY_NOTES_FALLBACK}\n`);
    expect(sanitizeReleaseNotes("   \n\n")).toBe(`${EMPTY_NOTES_FALLBACK}\n`);
  });

  it("leaves publisher freeform notes without changelog headings intact", () => {
    const wordsmithered = "Smoother playback and a quieter updater.\n";
    expect(sanitizeReleaseNotes(wordsmithered)).toBe(wordsmithered);
  });
});

describe("parseSanitizeNotesCli", () => {
  it("accepts --dry-run before or after the tag", () => {
    expect(parseSanitizeNotesCli(["v0.2.0"])).toEqual({
      tag: "v0.2.0",
      dryRun: false,
    });
    expect(parseSanitizeNotesCli(["v0.2.0", "--dry-run"])).toEqual({
      tag: "v0.2.0",
      dryRun: true,
    });
    expect(parseSanitizeNotesCli(["--dry-run", "v0.2.0"])).toEqual({
      tag: "v0.2.0",
      dryRun: true,
    });
    expect(parseSanitizeNotesCli(["-n", "v0.2.0"])).toEqual({
      tag: "v0.2.0",
      dryRun: true,
    });
  });

  it("rejects unknown flags and extra positionals", () => {
    expect(parseSanitizeNotesCli(["v0.2.0", "--nope"])).toEqual({
      error: "Unknown option: --nope",
    });
    expect(parseSanitizeNotesCli(["v0.2.0", "v0.2.1"])).toEqual({
      error: "Unexpected argument: v0.2.1",
    });
  });
});
