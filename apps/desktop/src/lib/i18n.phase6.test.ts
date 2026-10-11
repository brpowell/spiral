import { describe, expect, it } from "vitest";
import { t } from "./i18n";
import { convertTracksSettleOptions } from "./convertTracks";
import { formatImportSummary } from "./import";
import { formatLyricsFetchPeerTitle } from "./lyricsFetchToastSettle";
import { resolveSkinTooltip } from "./skinTooltips";
import { queueAddedPayload } from "./toastPayloads";
import { minimalBindState } from "../test/skinBindFixtures";

describe("i18n Phase 6 catalogs", () => {
  it("resolves toast labels and plural forms", () => {
    expect(t("toasts:queue.added", { count: 1 })).toBe("Added to queue");
    expect(t("toasts:queue.added", { count: 5 })).toBe(
      "5 tracks added to queue",
    );
    expect(t("toasts:convert.converted", { count: 8 })).toBe("8 converted");
    expect(t("toasts:import.imported", { count: 1 })).toBe("1 imported");
    expect(t("toasts:lyrics.partFetched", { count: 2 })).toBe("2 fetched");
    expect(t("toasts:lyricsMissing.noneMissing")).toBe(
      "No tracks missing lyrics",
    );
    expect(t("toasts:cancelled")).toBe("Cancelled");
  });

  it("resolves skin tooltip defaults with interpolation", () => {
    expect(t("playback:skinTooltips.volume", { percent: 72 })).toBe(
      "Volume: 72%",
    );
    expect(t("playback:skinTooltips.balanceLeft", { percent: 40 })).toBe(
      "Balance: L40",
    );
    expect(t("playback:skinTooltips.openNamed", { view: "playlist" })).toBe(
      "Open playlist",
    );
    expect(
      t("playback:skinTooltips.eqBand", { freq: "1k", gain: "+6.0 dB" }),
    ).toBe("1k: +6.0 dB");
    expect(t("playback:skinTooltips.elapsed", { time: "1:23" })).toBe(
      "Elapsed: 1:23 (click for remaining)",
    );
  });
});

describe("Phase 6 helpers use catalogs", () => {
  it("formats queue, lyrics, convert, and import summaries from catalogs", () => {
    expect(queueAddedPayload([{ title: "Song" }])?.label).toBe(
      "Added to queue",
    );
    expect(
      formatLyricsFetchPeerTitle({
        found: 1,
        notFound: 1,
        ambiguous: 1,
        failed: 1,
      }),
    ).toBe("Lyrics: 1 fetched · 1 not found · 1 need review · 1 failed");
    expect(
      convertTracksSettleOptions({
        converted: 8,
        failed: 2,
        errors: ["A", "B"],
        operationId: "op",
      }).label,
    ).toBe("8 converted · 2 failed");
    expect(
      formatImportSummary({
        imported: 8,
        replaced: 2,
        skipped: 2,
        failed: 0,
      }),
    ).toBe("8 imported · 2 replaced · 2 skipped");
  });

  it("resolves default skin tooltips and leaves authored templates intact", () => {
    expect(
      resolveSkinTooltip({ action: "player.toggleMute" }, minimalBindState()),
    ).toBe("Mute");
    expect(
      resolveSkinTooltip({}, minimalBindState(), {
        sliderMode: "volume",
        ratio: 0.4,
      }),
    ).toBe("Volume: 40%");
    expect(
      resolveSkinTooltip(
        { action: "player.toggleMute", tooltip: "Skin-authored mute" },
        minimalBindState(),
      ),
    ).toBe("Skin-authored mute");
  });
});
