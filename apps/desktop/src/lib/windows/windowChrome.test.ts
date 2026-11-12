import { afterEach, describe, expect, it, vi } from "vitest";

const installWindowFrameMock = vi.fn();

vi.mock("./windowFrame", () => ({
  installWindowFrame: () => installWindowFrameMock(),
}));

import {
  applyCustomWindowChrome,
  getDesktopPlatform,
  usesCustomWindowChrome,
  usesMacOverlayChrome,
} from "./windowChrome";

describe("windowChrome", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    installWindowFrameMock.mockReset();
  });

  it("keeps the GTK frame on Linux and clips only from the window itself", async () => {
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (X11; Linux x86_64)",
    });
    const target = {
      setDecorations: vi.fn(),
      setShadow: vi.fn(),
      setTitleBarStyle: vi.fn(),
    };

    await applyCustomWindowChrome(target);
    expect(installWindowFrameMock).not.toHaveBeenCalled();
    expect(target.setDecorations).not.toHaveBeenCalled();

    await applyCustomWindowChrome();
    expect(installWindowFrameMock).toHaveBeenCalledTimes(1);
  });

  it("drops decorations and keeps the shadow on Windows", async () => {
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    });
    const target = {
      setDecorations: vi.fn().mockResolvedValue(undefined),
      setShadow: vi.fn().mockResolvedValue(undefined),
      setTitleBarStyle: vi.fn(),
    };

    await applyCustomWindowChrome(target);
    expect(target.setDecorations).toHaveBeenCalledWith(false);
    expect(target.setShadow).toHaveBeenCalledWith(true);
    expect(installWindowFrameMock).not.toHaveBeenCalled();
  });

  it("treats Windows as custom chrome", () => {
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    });
    expect(getDesktopPlatform()).toBe("windows");
    expect(usesCustomWindowChrome()).toBe(true);
  });

  it("keeps macOS traffic lights and paints an overlay bar", () => {
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)",
    });
    expect(getDesktopPlatform()).toBe("macos");
    expect(usesCustomWindowChrome()).toBe(false);
    expect(usesMacOverlayChrome()).toBe(true);
  });

  it("treats Linux as custom chrome", () => {
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (X11; Linux x86_64)",
    });
    expect(getDesktopPlatform()).toBe("linux");
    expect(usesCustomWindowChrome()).toBe(true);
  });
});
