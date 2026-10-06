import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAsk = vi.hoisted(() => vi.fn());
const mockMessage = vi.hoisted(() => vi.fn());
const mockOpenUrl = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: mockAsk,
  message: mockMessage,
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: mockOpenUrl,
}));

import { confirmAndOpenSkinUrl } from "./skinOpenUrl";

describe("confirmAndOpenSkinUrl", () => {
  beforeEach(() => {
    mockAsk.mockReset();
    mockMessage.mockReset();
    mockOpenUrl.mockReset();
    mockAsk.mockResolvedValue(true);
    mockMessage.mockResolvedValue(undefined);
    mockOpenUrl.mockResolvedValue(undefined);
  });

  it("opens the normalized href after confirm", async () => {
    await confirmAndOpenSkinUrl("https://example.com/path");

    expect(mockAsk).toHaveBeenCalledWith(
      expect.stringContaining("https://example.com/path"),
      expect.objectContaining({
        title: "Open this link?",
        kind: "warning",
        okLabel: "Open",
        cancelLabel: "Cancel",
      }),
    );
    expect(mockOpenUrl).toHaveBeenCalledWith("https://example.com/path");
    expect(mockMessage).not.toHaveBeenCalled();
  });

  it("does not open when the user cancels", async () => {
    mockAsk.mockResolvedValue(false);

    await confirmAndOpenSkinUrl("https://example.com/");

    expect(mockAsk).toHaveBeenCalledOnce();
    expect(mockOpenUrl).not.toHaveBeenCalled();
  });

  it.each(["file:///etc/passwd", "javascript:alert(1)", "not a url", ""])(
    "shows a blocked message for %s",
    async (url) => {
      await confirmAndOpenSkinUrl(url);

      expect(mockMessage).toHaveBeenCalledWith(
        "This address isn't a web page, so Spiral won't open it.",
        expect.objectContaining({
          title: "Can't open this link",
          kind: "error",
        }),
      );
      expect(mockAsk).not.toHaveBeenCalled();
      expect(mockOpenUrl).not.toHaveBeenCalled();
    },
  );

  it("ignores a second call while a dialog is open", async () => {
    let resolveAsk: (value: boolean) => void = () => {};
    mockAsk.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          resolveAsk = resolve;
        }),
    );

    const first = confirmAndOpenSkinUrl("https://example.com/first");
    const second = confirmAndOpenSkinUrl("https://example.com/second");

    await second;
    expect(mockAsk).toHaveBeenCalledTimes(1);

    resolveAsk(true);
    await first;

    expect(mockOpenUrl).toHaveBeenCalledTimes(1);
    expect(mockOpenUrl).toHaveBeenCalledWith("https://example.com/first");
  });
});
