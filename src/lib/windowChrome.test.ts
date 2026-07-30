import { afterEach, describe, expect, it, vi } from "vitest";
import { getDesktopPlatform, usesCustomWindowChrome } from "./windowChrome";

describe("windowChrome", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("treats Windows as custom chrome", () => {
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" });
    expect(getDesktopPlatform()).toBe("windows");
    expect(usesCustomWindowChrome()).toBe(true);
  });

  it("keeps macOS on system chrome", () => {
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)" });
    expect(getDesktopPlatform()).toBe("macos");
    expect(usesCustomWindowChrome()).toBe(false);
  });

  it("treats Linux as custom chrome", () => {
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (X11; Linux x86_64)" });
    expect(getDesktopPlatform()).toBe("linux");
    expect(usesCustomWindowChrome()).toBe(true);
  });
});
