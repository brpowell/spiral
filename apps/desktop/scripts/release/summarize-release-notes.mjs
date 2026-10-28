#!/usr/bin/env node
/**
 * Add a short, user-facing summary on top of a sanitized GitHub Release body,
 * with the Features / Bug Fixes line items kept in a collapsed <details>.
 *
 * Runs after sanitize-release-notes.mjs on the draft (CI) and for backfill:
 *   npm run release -- summarize-notes <tag>
 *   npm run release -- summarize-notes <tag> --dry-run
 *
 * The summary is a draft for the release manager to review, edit and sign
 * off on, and the body says so (see composeNotes).
 *
 * Auth, first match wins:
 *   1. ANTHROPIC_API_KEY (local runs, testing).
 *   2. Workload Identity Federation (CI): a short-lived identity token is
 *      exchanged for an Anthropic access token, so no long-lived key is stored.
 *      See resolveAuth for the environment variables.
 *
 * The model defaults to DEFAULT_MODEL and can be overridden with
 * RELEASE_NOTES_MODEL. `gh` needs contents:write to edit a release;
 * `--dry-run` only reads.
 */
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EMPTY_NOTES_FALLBACK,
  ghJson,
  repoArgs,
  sanitizeReleaseNotes,
} from "./sanitize-release-notes.mjs";

export const DEFAULT_MODEL = "claude-sonnet-5-5";
export const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
export const OAUTH_TOKEN_URL = "https://api.anthropic.com/v1/oauth/token";
export const FEDERATION_AUDIENCE = "https://api.anthropic.com";
export const DETAILS_LABEL = "All changes";

const SYSTEM_PROMPT = `You write the "What's New" summary for Spiral, a desktop music player, from a list of changes in one release.

The reader is an end user, not a developer. Write the highlights they would care about, in plain language.

Format (markdown only, no preamble):
- One short opening sentence that sets the tone for the release.
- Then a bulleted list of 3 to 5 highlights, most important first. Each bullet starts with a short bold phrase, followed by one sentence on what changed and why it matters to the listener.
- If the release is small, use fewer bullets. If it is only a handful of minor fixes, a single sentence is enough.

Voice:
- Natural and a little friendly, like a well-written product update. Plain words, no hype, no filler.
- Do not write as a person or a character. No first person ("I", "we", "our"), no feelings ("excited", "thrilled", "happy to"), no addressing the reader as a friend. Spiral is the subject: "Spiral now ...", or describe the change directly.
- No emoji, no exclamation marks.

Content rules:
- Use only what is in the list. Do not invent features, numbers or details.
- Leave out purely internal changes (refactors, tooling, dependencies, tests) unless a user would notice them.
- Treat behind-the-scenes work (registry, backend, data collection, tracking, APIs) the same way: include it only when the list shows people can see or use the result in the app, such as a count that now appears in the interface. If the list gives no sign of that, leave it out.
- Merge related items into one highlight.
- Do not mention version numbers, dates, pull requests or commit hashes.
- Do not add headings, code fences or HTML.`;

/** Model from RELEASE_NOTES_MODEL, falling back to DEFAULT_MODEL when unset or blank. */
export function resolveModel(env = process.env) {
  const configured = env.RELEASE_NOTES_MODEL?.trim();
  return configured ? configured : DEFAULT_MODEL;
}

const DETAILS_RE =
  /<details[^>]*>\s*<summary>[\s\S]*?<\/summary>([\s\S]*?)<\/details>/i;

/**
 * Pull the line items back out of a body that was already summarized.
 *
 * @param {string} body
 * @returns {{ lineItems: string } | null}
 */
export function parseSummarizedNotes(body) {
  const match = String(body ?? "")
    .replace(/\r\n/g, "\n")
    .match(DETAILS_RE);
  if (!match) return null;
  return { lineItems: match[1].trim() };
}

/**
 * @param {string} lineItems Sanitized Features / Bug Fixes markdown.
 * @returns {string}
 */
export function buildUserPrompt(lineItems) {
  return `Changes in this release:\n\n${lineItems.trim()}\n`;
}

/**
 * Normalize the model's reply: strip a wrapping code fence and any leading
 * headings, and refuse output that would break the body's structure.
 *
 * @param {string} text
 * @returns {string}
 */
export function cleanSummary(text) {
  let out = String(text ?? "").trim();
  const fenced = out.match(/^```(?:markdown|md)?\n([\s\S]*?)\n```$/);
  if (fenced) out = fenced[1].trim();
  out = out.replace(/^(?:#{1,6}[ \t].*(?:\n|$))+/, "").trim();
  if (out.length === 0) throw new Error("Model returned an empty summary");
  if (/<\/?details/i.test(out) || /<\/?summary/i.test(out)) {
    throw new Error("Model returned HTML the notes cannot contain");
  }
  return out;
}

/**
 * A visible banner on purpose: the notes ship exactly as published, so a
 * release manager who skips the review ships the banner too. It reads fine as
 * a plain blockquote both on GitHub and in What's New.
 *
 * @param {string} model
 * @returns {string}
 */
export function reviewNotice(model) {
  const label = String(model).replace(/[^\w.-]/g, "");
  return `> **Draft: review before publishing.** This summary was written by ${label}. Read it, fix anything wrong or off-tone, then delete this notice. Whatever is here when you publish is what users see.`;
}

/**
 * @param {string} summary
 * @param {string} lineItems
 * @param {{ model?: string }} [options]
 * @returns {string}
 */
export function composeNotes(
  summary,
  lineItems,
  { model = DEFAULT_MODEL } = {},
) {
  // Blank lines around the markdown inside <details> are required for GitHub
  // to render it.
  return `${reviewNotice(model)}

${summary.trim()}

<details>
<summary>${DETAILS_LABEL}</summary>

${lineItems.trim()}

</details>
`;
}

async function readJsonOrThrow(response, what) {
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 500);
    throw new Error(`${what} returned ${response.status}: ${detail}`);
  }
  return response.json();
}

/**
 * The identity token for the exchange: ANTHROPIC_IDENTITY_TOKEN, then
 * ANTHROPIC_IDENTITY_TOKEN_FILE, then GitHub Actions' OIDC endpoint (needs
 * `permissions: id-token: write`). GitHub tokens are fetched here, once, since
 * a token that carries a `jti` is accepted for only one exchange.
 */
async function loadIdentityToken(env, fetchImpl) {
  const inline = env.ANTHROPIC_IDENTITY_TOKEN?.trim();
  if (inline) return inline;

  const file = env.ANTHROPIC_IDENTITY_TOKEN_FILE?.trim();
  if (file) return (await readFile(file, "utf8")).trim();

  const requestUrl = env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const requestToken = env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (requestUrl && requestToken) {
    const url = new URL(requestUrl);
    url.searchParams.set("audience", FEDERATION_AUDIENCE);
    const data = await readJsonOrThrow(
      await fetchImpl(url, {
        headers: { authorization: `Bearer ${requestToken}` },
      }),
      "GitHub OIDC token endpoint",
    );
    if (typeof data?.value !== "string" || data.value.length === 0) {
      throw new Error("GitHub OIDC token endpoint returned no token");
    }
    return data.value;
  }

  throw new Error(
    "No identity token: set ANTHROPIC_IDENTITY_TOKEN(_FILE), or run in GitHub Actions with `id-token: write`",
  );
}

/**
 * Headers that authenticate a Messages API call.
 *
 * ANTHROPIC_API_KEY wins when set (local runs). Otherwise, with
 * ANTHROPIC_FEDERATION_RULE_ID, ANTHROPIC_ORGANIZATION_ID and
 * ANTHROPIC_SERVICE_ACCOUNT_ID set (plus ANTHROPIC_WORKSPACE_ID when the rule
 * covers more than one workspace), the identity token is exchanged at
 * /v1/oauth/token for a short-lived access token.
 *
 * @param {{ env?: NodeJS.ProcessEnv, fetchImpl?: typeof fetch }} [options]
 * @returns {Promise<{ source: "api-key" | "workload-identity", headers: Record<string, string> }>}
 */
export async function resolveAuth({
  env = process.env,
  fetchImpl = fetch,
} = {}) {
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (apiKey) {
    return { source: "api-key", headers: { "x-api-key": apiKey } };
  }

  const ruleId = env.ANTHROPIC_FEDERATION_RULE_ID?.trim();
  const organizationId = env.ANTHROPIC_ORGANIZATION_ID?.trim();
  const serviceAccountId = env.ANTHROPIC_SERVICE_ACCOUNT_ID?.trim();
  if (!ruleId || !organizationId || !serviceAccountId) {
    throw new Error(
      "No credentials: set ANTHROPIC_API_KEY, or ANTHROPIC_FEDERATION_RULE_ID, ANTHROPIC_ORGANIZATION_ID and ANTHROPIC_SERVICE_ACCOUNT_ID for Workload Identity Federation",
    );
  }

  const assertion = await loadIdentityToken(env, fetchImpl);
  const workspaceId = env.ANTHROPIC_WORKSPACE_ID?.trim();
  const data = await readJsonOrThrow(
    await fetchImpl(OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
        federation_rule_id: ruleId,
        organization_id: organizationId,
        service_account_id: serviceAccountId,
        ...(workspaceId ? { workspace_id: workspaceId } : {}),
      }),
    }),
    "Anthropic token exchange",
  );
  if (typeof data?.access_token !== "string" || !data.access_token) {
    throw new Error("Anthropic token exchange returned no access token");
  }
  return {
    source: "workload-identity",
    headers: { authorization: `Bearer ${data.access_token}` },
  };
}

/**
 * @param {{
 *   lineItems: string,
 *   authHeaders: Record<string, string>,
 *   model?: string,
 *   fetchImpl?: typeof fetch,
 * }} options
 * @returns {Promise<string>}
 */
export async function generateSummary({
  lineItems,
  authHeaders,
  model = DEFAULT_MODEL,
  fetchImpl = fetch,
}) {
  const data = await readJsonOrThrow(
    await fetchImpl(ANTHROPIC_MESSAGES_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...authHeaders,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildUserPrompt(lineItems) }],
      }),
    }),
    "Anthropic API",
  );

  const text = Array.isArray(data?.content)
    ? data.content
        .filter((block) => block?.type === "text")
        .map((block) => block.text)
        .join("")
    : "";
  return cleanSummary(text);
}

function usage(exitCode = 0) {
  console.log(`Add an AI-written summary to a GitHub Release body for What's New.

Usage:
  npm run release -- summarize-notes <tag>
  npm run release -- summarize-notes <tag> --dry-run

Options:
  --dry-run, -n   Print the new notes to stdout; do not edit the release
  --force, -f     Regenerate the summary when the release already has one

Environment:
  ANTHROPIC_API_KEY     Local runs and testing
  ANTHROPIC_FEDERATION_RULE_ID, ANTHROPIC_ORGANIZATION_ID,
  ANTHROPIC_SERVICE_ACCOUNT_ID, ANTHROPIC_WORKSPACE_ID (optional)
                        Workload Identity Federation, used when no API key is
                        set (CI). The identity token comes from
                        ANTHROPIC_IDENTITY_TOKEN(_FILE) or GitHub Actions.
  RELEASE_NOTES_MODEL   Optional model override (default ${DEFAULT_MODEL})

Examples:
  npm run release -- summarize-notes desktop-v0.2.0
  npm run release -- summarize-notes desktop-v0.2.0 --dry-run

Run sanitize-notes first on a raw changelog body (this command sanitizes the
line items itself, but never rewrites a body that was hand-edited into a
summary). The Features / Bug Fixes line items are kept in a collapsed section.
`);
  process.exit(exitCode);
}

/**
 * @param {string[]} argv
 * @returns {{ help: true } | { error: string } | { tag: string, dryRun: boolean, force: boolean }}
 */
export function parseSummarizeNotesCli(argv) {
  let dryRun = false;
  let force = false;
  /** @type {string[]} */
  const positional = [];
  for (const arg of argv) {
    if (arg === "-h" || arg === "--help") return { help: true };
    if (arg === "--dry-run" || arg === "-n") {
      dryRun = true;
      continue;
    }
    if (arg === "--force" || arg === "-f") {
      force = true;
      continue;
    }
    if (arg.startsWith("-")) return { error: `Unknown option: ${arg}` };
    positional.push(arg);
  }
  if (positional.length > 1) {
    return { error: `Unexpected argument: ${positional[1]}` };
  }
  return { tag: positional[0], dryRun, force };
}

async function summarizeTagNotes(tag, { dryRun, force }) {
  const extra = repoArgs();
  let release;
  try {
    release = ghJson(["release", "view", tag, "--json", "body,url", ...extra]);
  } catch (err) {
    console.error(`Could not load release ${tag}: ${err.message}`);
    process.exit(1);
  }

  const current = release.body ?? "";
  const existing = parseSummarizedNotes(current);
  if (existing && !force) {
    console.log(`Notes for ${tag} already have a summary; no change.`);
    console.log(release.url);
    return;
  }

  const lineItems = (
    existing ? existing.lineItems : sanitizeReleaseNotes(current)
  ).trim();
  if (lineItems === EMPTY_NOTES_FALLBACK) {
    console.log(`Nothing to summarize for ${tag}; no change.`);
    console.log(release.url);
    return;
  }

  const model = resolveModel();
  let summary;
  try {
    const auth = await resolveAuth();
    console.error(`Authenticating with ${auth.source}.`);
    summary = await generateSummary({
      lineItems,
      authHeaders: auth.headers,
      model,
    });
  } catch (err) {
    console.error(`Could not summarize ${tag} with ${model}: ${err.message}`);
    process.exit(1);
  }

  const notes = composeNotes(summary, lineItems, { model });
  if (dryRun) {
    process.stdout.write(notes);
    return;
  }

  const edit = spawnSync(
    "gh",
    ["release", "edit", tag, "--notes-file", "-", ...extra],
    {
      encoding: "utf8",
      input: notes,
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
  console.log(`Added a summary to the notes for ${tag} (${model}).`);
  console.log(release.url);
  if (process.env.GITHUB_ACTIONS === "true") {
    console.log(
      `::notice title=Review the release notes::The summary for ${tag} was written by ${model}. Review and edit the draft before publishing.`,
    );
  }
}

async function main() {
  const parsed = parseSummarizeNotesCli(process.argv.slice(2));
  if ("help" in parsed) usage(0);
  if ("error" in parsed) {
    console.error(parsed.error);
    usage(1);
  }
  const { tag, dryRun, force } = parsed;
  if (!tag) usage(1);
  if (!/^desktop-v\d+\.\d+\.\d+/.test(tag)) {
    console.error(
      `Expected a desktop release tag like desktop-v0.2.0, got: ${tag}`,
    );
    process.exit(1);
  }
  await summarizeTagNotes(tag, { dryRun, force });
}

const invokedDirectly =
  Boolean(process.argv[1]) &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (invokedDirectly) {
  await main();
}
