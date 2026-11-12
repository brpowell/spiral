// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
const listenMock = vi.fn();
const unlistenMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    listen: (...args: unknown[]) => listenMock(...args),
  }),
}));

import {
  WINDOW_FRAME_EVENT,
  installWindowFrame,
  setWindowFrameAttribute,
} from "./windowFrame";

describe("windowFrame", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = document.createElement("html");
    invokeMock.mockReset();
    listenMock.mockReset();
    unlistenMock.mockReset();
    listenMock.mockResolvedValue(unlistenMock);
  });

  it("marks the page rounded, square, or not framed", () => {
    setWindowFrameAttribute(root, { enabled: true, rounded: true });
    expect(root.dataset.windowFrame).toBe("rounded");
    setWindowFrameAttribute(root, { enabled: true, rounded: false });
    expect(root.dataset.windowFrame).toBe("square");
    setWindowFrameAttribute(root, { enabled: false, rounded: false });
    expect(root.dataset.windowFrame).toBeUndefined();
  });

  it("follows frame events after install", async () => {
    invokeMock.mockResolvedValue({ enabled: true, rounded: true });
    await installWindowFrame(root);

    expect(invokeMock).toHaveBeenCalledWith("window_frame");
    expect(root.dataset.windowFrame).toBe("rounded");
    expect(listenMock).toHaveBeenCalledWith(
      WINDOW_FRAME_EVENT,
      expect.any(Function),
    );

    const handler = listenMock.mock.calls[0][1] as (event: {
      payload: boolean;
    }) => void;
    handler({ payload: false });
    expect(root.dataset.windowFrame).toBe("square");
    expect(unlistenMock).not.toHaveBeenCalled();
  });

  it("stops listening when the backend call fails", async () => {
    invokeMock.mockRejectedValue(new Error("no window"));
    await expect(installWindowFrame(root)).rejects.toThrow("no window");

    expect(root.dataset.windowFrame).toBeUndefined();
    expect(unlistenMock).toHaveBeenCalled();
  });

  it("stops listening when the window has no frame", async () => {
    invokeMock.mockResolvedValue({ enabled: false, rounded: false });
    await installWindowFrame(root);

    expect(root.dataset.windowFrame).toBeUndefined();
    expect(unlistenMock).toHaveBeenCalled();
  });
});
