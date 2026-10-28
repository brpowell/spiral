import { describe, expect, it, vi } from "vitest";
import { sanitizeReleaseNotes } from "./sanitize-release-notes.mjs";
import {
  ANTHROPIC_MESSAGES_URL,
  DEFAULT_MODEL,
  FEDERATION_AUDIENCE,
  OAUTH_TOKEN_URL,
  buildUserPrompt,
  cleanSummary,
  composeNotes,
  generateSummary,
  parseSummarizeNotesCli,
  parseSummarizedNotes,
  resolveAuth,
  resolveModel,
  reviewNotice,
} from "./summarize-release-notes.mjs";

const LINE_ITEMS = `### Features

* play all audio through a native output

### Bug Fixes

* delete playlist body not appearing
`;

function okResponse(text) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ content: [{ type: "text", text }] }),
    text: async () => "",
  };
}

describe("resolveModel", () => {
  it("defaults to claude-sonnet-5-5", () => {
    expect(DEFAULT_MODEL).toBe("claude-sonnet-5-5");
    expect(resolveModel({})).toBe(DEFAULT_MODEL);
  });

  it("uses RELEASE_NOTES_MODEL when set and ignores blank values", () => {
    expect(resolveModel({ RELEASE_NOTES_MODEL: " claude-opus-5-5 " })).toBe(
      "claude-opus-5-5",
    );
    expect(resolveModel({ RELEASE_NOTES_MODEL: "  " })).toBe(DEFAULT_MODEL);
  });
});

describe("composeNotes / parseSummarizedNotes", () => {
  it("puts the summary first and the line items in a collapsed section", () => {
    const out = composeNotes("Smoother playback.\n", LINE_ITEMS);
    expect(out).toBe(`${reviewNotice(DEFAULT_MODEL)}

Smoother playback.

<details>
<summary>All changes</summary>

${LINE_ITEMS.trim()}

</details>
`);
  });

  it("opens with a visible review banner", () => {
    const out = composeNotes("Hi.", LINE_ITEMS, { model: "claude-opus-5-5" });
    const [first] = out.split("\n");
    expect(first).toMatch(/^> \*\*Draft: review before publishing\.\*\*/);
    expect(first).toContain("written by claude-opus-5-5");
    expect(first).toMatch(/what users see\.$/);
    expect(out).not.toContain("<!--");
  });

  it("keeps the banner on one blockquote line whatever the model name", () => {
    const notice = reviewNotice("x\n# <b>y</b>");
    expect(notice).not.toContain("\n");
    expect(notice.slice(2)).not.toMatch(/[<>#]/);
  });

  it("round-trips the line items", () => {
    const out = composeNotes("Smoother playback.", LINE_ITEMS);
    expect(parseSummarizedNotes(out)).toEqual({
      lineItems: LINE_ITEMS.trim(),
    });
  });

  it("returns null for notes without a details block", () => {
    expect(parseSummarizedNotes(LINE_ITEMS)).toBeNull();
  });

  it("is left alone by the sanitizer", () => {
    const out = composeNotes("Smoother playback.", LINE_ITEMS);
    expect(sanitizeReleaseNotes(out)).toBe(out);
  });
});

describe("cleanSummary", () => {
  it("trims, unwraps a code fence and drops leading headings", () => {
    expect(cleanSummary("\n## v0.4.0\n\nHello.\n")).toBe("Hello.");
    expect(cleanSummary("```markdown\nHello.\n```")).toBe("Hello.");
  });

  it("rejects empty output and HTML that would break the body", () => {
    expect(() => cleanSummary("  ")).toThrow(/empty/);
    expect(() => cleanSummary("Hi\n</details>")).toThrow(/HTML/);
  });
});

describe("generateSummary", () => {
  it("calls the Messages API with the key, model and line items", async () => {
    const fetchImpl = vi.fn(async () => okResponse("Smoother playback."));
    const out = await generateSummary({
      lineItems: LINE_ITEMS,
      authHeaders: { "x-api-key": "sk-test" },
      model: "claude-opus-5-5",
      fetchImpl,
    });

    expect(out).toBe("Smoother playback.");
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(ANTHROPIC_MESSAGES_URL);
    expect(init.headers["x-api-key"]).toBe("sk-test");
    const body = JSON.parse(init.body);
    expect(body.model).toBe("claude-opus-5-5");
    expect(body.messages).toEqual([
      { role: "user", content: buildUserPrompt(LINE_ITEMS) },
    ]);
    expect(body.system).toMatch(/end user/);
    expect(body.system).toMatch(/behind-the-scenes/);
  });

  it("sends bearer auth from a federated token", async () => {
    const fetchImpl = vi.fn(async () => okResponse("Hi."));
    await generateSummary({
      lineItems: LINE_ITEMS,
      authHeaders: { authorization: "Bearer sk-ant-oat01-x" },
      fetchImpl,
    });
    const [, init] = fetchImpl.mock.calls[0];
    expect(init.headers.authorization).toBe("Bearer sk-ant-oat01-x");
    expect(init.headers["x-api-key"]).toBeUndefined();
  });

  it("surfaces API errors", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => "invalid x-api-key",
    }));
    await expect(
      generateSummary({
        lineItems: LINE_ITEMS,
        authHeaders: { "x-api-key": "bad" },
        fetchImpl,
      }),
    ).rejects.toThrow(/401: invalid x-api-key/);
  });
});

describe("parseSummarizeNotesCli", () => {
  it("accepts flags before or after the tag", () => {
    expect(parseSummarizeNotesCli(["desktop-v0.2.0"])).toEqual({
      tag: "desktop-v0.2.0",
      dryRun: false,
      force: false,
    });
    expect(parseSummarizeNotesCli(["-n", "desktop-v0.2.0", "--force"])).toEqual(
      { tag: "desktop-v0.2.0", dryRun: true, force: true },
    );
  });

  it("rejects unknown flags and extra positionals", () => {
    expect(parseSummarizeNotesCli(["x", "--nope"])).toEqual({
      error: "Unknown option: --nope",
    });
    expect(parseSummarizeNotesCli(["a", "b"])).toEqual({
      error: "Unexpected argument: b",
    });
  });
});

describe("resolveAuth", () => {
  const FEDERATION_ENV = {
    ANTHROPIC_FEDERATION_RULE_ID: "fdrl_1",
    ANTHROPIC_ORGANIZATION_ID: "org-1",
    ANTHROPIC_SERVICE_ACCOUNT_ID: "svac_1",
  };

  it("prefers ANTHROPIC_API_KEY, and ignores a blank one", async () => {
    const fetchImpl = vi.fn();
    await expect(
      resolveAuth({
        env: { ANTHROPIC_API_KEY: " sk-test ", ...FEDERATION_ENV },
        fetchImpl,
      }),
    ).resolves.toEqual({
      source: "api-key",
      headers: { "x-api-key": "sk-test" },
    });
    expect(fetchImpl).not.toHaveBeenCalled();

    await expect(
      resolveAuth({ env: { ANTHROPIC_API_KEY: "  " }, fetchImpl }),
    ).rejects.toThrow(/No credentials/);
  });

  it("exchanges a GitHub Actions identity token for an access token", async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (String(url).startsWith("https://token.example/oidc")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ value: "jwt-1" }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          access_token: "sk-ant-oat01-abc",
          expires_in: 600,
        }),
      };
    });

    const auth = await resolveAuth({
      env: {
        ...FEDERATION_ENV,
        ACTIONS_ID_TOKEN_REQUEST_URL: "https://token.example/oidc?x=1",
        ACTIONS_ID_TOKEN_REQUEST_TOKEN: "req-token",
      },
      fetchImpl,
    });

    expect(auth).toEqual({
      source: "workload-identity",
      headers: { authorization: "Bearer sk-ant-oat01-abc" },
    });

    const [oidcUrl, oidcInit] = fetchImpl.mock.calls[0];
    expect(new URL(oidcUrl).searchParams.get("audience")).toBe(
      FEDERATION_AUDIENCE,
    );
    expect(oidcInit.headers.authorization).toBe("Bearer req-token");

    const [tokenUrl, tokenInit] = fetchImpl.mock.calls[1];
    expect(tokenUrl).toBe(OAUTH_TOKEN_URL);
    expect(JSON.parse(tokenInit.body)).toEqual({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: "jwt-1",
      federation_rule_id: "fdrl_1",
      organization_id: "org-1",
      service_account_id: "svac_1",
    });
  });

  it("includes the workspace when configured and prefers ANTHROPIC_IDENTITY_TOKEN", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ access_token: "sk-ant-oat01-abc" }),
    }));
    await resolveAuth({
      env: {
        ...FEDERATION_ENV,
        ANTHROPIC_WORKSPACE_ID: "wrkspc_1",
        ANTHROPIC_IDENTITY_TOKEN: "jwt-env",
        ACTIONS_ID_TOKEN_REQUEST_URL: "https://token.example/oidc",
        ACTIONS_ID_TOKEN_REQUEST_TOKEN: "req-token",
      },
      fetchImpl,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.assertion).toBe("jwt-env");
    expect(body.workspace_id).toBe("wrkspc_1");
  });

  it("explains a missing identity token, and surfaces a denied exchange", async () => {
    await expect(
      resolveAuth({ env: FEDERATION_ENV, fetchImpl: vi.fn() }),
    ).rejects.toThrow(/id-token: write/);

    const denied = vi.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => "Authentication failed",
    }));
    await expect(
      resolveAuth({
        env: { ...FEDERATION_ENV, ANTHROPIC_IDENTITY_TOKEN: "jwt" },
        fetchImpl: denied,
      }),
    ).rejects.toThrow(/token exchange returned 401: Authentication failed/);
  });
});
