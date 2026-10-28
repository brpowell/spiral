import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RELEASES_HISTORY_URL,
  ReleaseHistoryError,
  canShowUpdateAction,
  fetchReleaseHistory,
  formatReleaseDate,
  normalizeReleaseVersion,
  parseReleaseNotes,
  pickSelectedVersion,
  releasesHistoryUrl,
  resolveWhatsNewRows,
  stripLeadingVersionHeading,
} from "./history";

describe("normalizeReleaseVersion", () => {
  it("strips a leading v", () => {
    expect(normalizeReleaseVersion("v0.2.2")).toBe("0.2.2");
    expect(normalizeReleaseVersion("0.2.2")).toBe("0.2.2");
    expect(normalizeReleaseVersion(" V1.0.0 ")).toBe("1.0.0");
  });
});

describe("resolveWhatsNewRows", () => {
  const history = [
    {
      version: "0.3.0",
      notes: "### Features\n\n* newest",
      pub_date: "2026-08-20",
    },
    {
      version: "0.2.2",
      notes: "### Bug Fixes\n\n* older",
      pub_date: "2026-08-03",
    },
  ];

  it("returns published history newest-first as given", () => {
    expect(resolveWhatsNewRows({ history, availableUpdate: null })).toEqual(
      history,
    );
  });

  it("prepends a pending update that is not in the list yet", () => {
    const rows = resolveWhatsNewRows({
      history,
      availableUpdate: {
        version: "v0.3.1",
        body: "### Features\n\n* pending",
        date: "2026-08-26",
      },
    });
    expect(rows.map((row) => row.version)).toEqual(["0.3.1", "0.3.0", "0.2.2"]);
    expect(rows[0].notes).toBe("### Features\n\n* pending");
  });

  it("does not duplicate a pending version that history already has", () => {
    const rows = resolveWhatsNewRows({
      history,
      availableUpdate: { version: "0.3.0", body: "ignored" },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0].notes).toBe("### Features\n\n* newest");
  });

  it("falls back to the pending body when history is empty", () => {
    const rows = resolveWhatsNewRows({
      history: [],
      availableUpdate: { version: "0.3.0", body: "from updater" },
    });
    expect(rows).toEqual([
      { version: "0.3.0", notes: "from updater", pub_date: "" },
    ]);
  });

  it("appends the installed version when it is not already in the list", () => {
    const rows = resolveWhatsNewRows({
      history: [],
      availableUpdate: {
        version: "99.0.0",
        body: "sim",
        date: "2026-08-26T00:00:00Z",
      },
      installedVersion: "v0.3.0",
    });
    expect(rows.map((row) => row.version)).toEqual(["99.0.0", "0.3.0"]);
    expect(rows[1]).toEqual({
      version: "0.3.0",
      notes: "",
      pub_date: "2026-08-25T00:00:00.000Z",
    });
  });

  it("does not duplicate the installed version", () => {
    const rows = resolveWhatsNewRows({
      history,
      availableUpdate: null,
      installedVersion: "0.3.0",
    });
    expect(rows.map((row) => row.version)).toEqual(["0.3.0", "0.2.2"]);
  });
});

describe("pickSelectedVersion", () => {
  const rows = [
    { version: "0.3.0", notes: "a", pub_date: "" },
    { version: "0.2.2", notes: "b", pub_date: "" },
  ];

  it("selects the focused version when it is in the list", () => {
    expect(pickSelectedVersion({ rows, focusVersion: "v0.2.2" })).toBe("0.2.2");
  });

  it("selects the latest row when there is no focus", () => {
    expect(pickSelectedVersion({ rows, focusVersion: null })).toBe("0.3.0");
  });

  it("falls back to latest when focus is missing from the list", () => {
    expect(pickSelectedVersion({ rows, focusVersion: "9.9.9" })).toBe("0.3.0");
  });

  it("returns null when there are no rows", () => {
    expect(pickSelectedVersion({ rows: [], focusVersion: "0.3.0" })).toBeNull();
  });
});

describe("canShowUpdateAction", () => {
  const rows = [
    { version: "0.3.0", notes: "a", pub_date: "" },
    { version: "0.2.2", notes: "b", pub_date: "" },
  ];

  it("is true only for the latest row matching the pending update", () => {
    expect(
      canShowUpdateAction({
        selectedVersion: "0.3.0",
        rows,
        availableUpdate: { version: "v0.3.0" },
      }),
    ).toBe(true);
  });

  it("is false for an older selected row", () => {
    expect(
      canShowUpdateAction({
        selectedVersion: "0.2.2",
        rows,
        availableUpdate: { version: "0.3.0" },
      }),
    ).toBe(false);
  });

  it("is false when already current", () => {
    expect(
      canShowUpdateAction({
        selectedVersion: "0.3.0",
        rows,
        availableUpdate: null,
      }),
    ).toBe(false);
  });
});

describe("formatReleaseDate", () => {
  const now = Date.parse("2026-08-26T12:00:00Z");

  it("returns empty for missing or invalid dates", () => {
    expect(formatReleaseDate("", now)).toBe("");
    expect(formatReleaseDate("not-a-date", now)).toBe("");
  });

  it("uses a relative label within a week", () => {
    expect(
      formatReleaseDate("2026-08-26T00:00:00Z", now).length,
    ).toBeGreaterThan(0);
    expect(
      formatReleaseDate("2026-08-24T12:00:00Z", now).length,
    ).toBeGreaterThan(0);
  });

  it("uses a short date beyond a week", () => {
    const formatted = formatReleaseDate("2026-08-03T00:00:00Z", now);
    expect(formatted).toMatch(/2026/);
  });
});

describe("releasesHistoryUrl", () => {
  it("falls back to the branded URL when the override is empty", () => {
    expect(releasesHistoryUrl("")).toBe(RELEASES_HISTORY_URL);
    expect(releasesHistoryUrl("  ")).toBe(RELEASES_HISTORY_URL);
  });

  it("uses SPIRAL_RELEASES_URL when set", () => {
    expect(releasesHistoryUrl("http://127.0.0.1:3000/api/releases")).toBe(
      "http://127.0.0.1:3000/api/releases",
    );
  });
});

describe("fetchReleaseHistory", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("requests the branded URL and normalizes versions", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        releases: [
          {
            version: "v0.3.0",
            notes: "notes",
            pub_date: "2026-08-20T00:00:00Z",
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const releases = await fetchReleaseHistory({ limit: 5 });
    expect(releases).toEqual([
      { version: "0.3.0", notes: "notes", pub_date: "2026-08-20T00:00:00Z" },
    ]);
    const requested = fetchMock.mock.calls[0][0] as URL;
    expect(requested.origin + requested.pathname).toBe(releasesHistoryUrl());
    expect(requested.searchParams.get("limit")).toBe("5");
  });

  it("throws on a non-OK response", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue({ ok: false, status: 503, json: async () => ({}) }),
    );
    await expect(fetchReleaseHistory()).rejects.toBeInstanceOf(
      ReleaseHistoryError,
    );
  });
});

describe("parseReleaseNotes", () => {
  const body = `Smoother playback.

<details>
<summary>All changes</summary>

### Features

* play all audio through a native output

</details>
`;

  it("splits the summary from the collapsed line items", () => {
    expect(parseReleaseNotes(body, "0.4.0")).toEqual({
      summary: "Smoother playback.",
      details: "### Features\n\n* play all audio through a native output",
    });
  });

  it("returns notes without a details block as the summary", () => {
    expect(parseReleaseNotes("### Features\n\n* a\n", "0.4.0")).toEqual({
      summary: "### Features\n\n* a",
      details: null,
    });
  });

  it("drops a leading heading that repeats the version", () => {
    expect(
      parseReleaseNotes(
        "## [0.4.0](https://x/y) (2026-10-23)\n\nHi.",
        "v0.4.0",
      ),
    ).toEqual({ summary: "Hi.", details: null });
    expect(stripLeadingVersionHeading("# 0.4.0\n\nHi.", "0.4.0")).toBe("Hi.");
  });

  it("keeps a leading heading that is not the version", () => {
    expect(stripLeadingVersionHeading("### Features\n\n* a", "0.4.0")).toBe(
      "### Features\n\n* a",
    );
  });

  it("ignores the publisher review comment", () => {
    expect(
      parseReleaseNotes(
        "<!-- Draft summary written by Claude. Review. -->\n\nHi.\n",
        "0.4.0",
      ),
    ).toEqual({ summary: "Hi.", details: null });
  });

  it("treats blank notes as empty", () => {
    expect(parseReleaseNotes("  \n", "0.4.0")).toEqual({
      summary: "",
      details: null,
    });
  });
});
