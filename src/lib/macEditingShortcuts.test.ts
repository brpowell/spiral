// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { applyMacEditingShortcuts } from "./macEditingShortcuts";

function keyDown(
  el: HTMLInputElement | HTMLTextAreaElement,
  key: string,
  options: { metaKey?: boolean; shiftKey?: boolean } = {},
) {
  const preventDefault = vi.fn();
  const event = {
    key,
    metaKey: options.metaKey ?? true,
    ctrlKey: false,
    shiftKey: options.shiftKey ?? false,
    currentTarget: el,
    preventDefault,
    defaultPrevented: false,
  };
  return { event, preventDefault };
}

describe("applyMacEditingShortcuts", () => {
  it("selects all text with Cmd+A", () => {
    const input = document.createElement("input");
    input.value = "hello";
    document.body.appendChild(input);
    const select = vi.spyOn(input, "select");

    const { event, preventDefault } = keyDown(input, "a");
    const handled = applyMacEditingShortcuts(event, () => null, () => null, () => {});

    expect(handled).toBe(true);
    expect(preventDefault).toHaveBeenCalled();
    expect(select).toHaveBeenCalled();
    input.remove();
  });

  it("copies the current selection with Cmd+C", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", {
      clipboard: { writeText, readText: vi.fn() },
    });

    const input = document.createElement("input");
    input.value = "hello world";
    input.setSelectionRange(0, 5);
    document.body.appendChild(input);

    const { event, preventDefault } = keyDown(input, "c");
    const handled = applyMacEditingShortcuts(event, () => null, () => null, () => {});

    expect(handled).toBe(true);
    expect(preventDefault).toHaveBeenCalled();
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledWith("hello");
    input.remove();
    vi.unstubAllGlobals();
  });

  it("cuts the current selection with Cmd+X", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", {
      clipboard: { writeText, readText: vi.fn() },
    });

    const input = document.createElement("input");
    input.value = "hello world";
    input.setSelectionRange(0, 5);
    document.body.appendChild(input);
    const syncChange = vi.fn();

    const { event, preventDefault } = keyDown(input, "x");
    const handled = applyMacEditingShortcuts(event, () => null, () => null, syncChange);

    expect(handled).toBe(true);
    expect(preventDefault).toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("hello");
      expect(input.value).toBe(" world");
      expect(syncChange).toHaveBeenCalledWith(input);
    });
    input.remove();
    vi.unstubAllGlobals();
  });

  it("pastes clipboard text with Cmd+V", async () => {
    const readText = vi.fn().mockResolvedValue(" pasted");
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn(), readText },
    });

    const input = document.createElement("input");
    input.value = "hello";
    input.setSelectionRange(5, 5);
    document.body.appendChild(input);
    const syncChange = vi.fn();

    const { event, preventDefault } = keyDown(input, "v");
    const handled = applyMacEditingShortcuts(event, () => null, () => null, syncChange);

    expect(handled).toBe(true);
    expect(preventDefault).toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(readText).toHaveBeenCalled();
      expect(input.value).toBe("hello pasted");
      expect(syncChange).toHaveBeenCalledWith(input);
    });
    input.remove();
    vi.unstubAllGlobals();
  });

  it("restores undo state with Cmd+Z", () => {
    const input = document.createElement("input");
    input.value = "changed";
    document.body.appendChild(input);
    const syncChange = vi.fn();

    const { event, preventDefault } = keyDown(input, "z");
    const handled = applyMacEditingShortcuts(
      event,
      () => "original",
      () => null,
      syncChange,
    );

    expect(handled).toBe(true);
    expect(preventDefault).toHaveBeenCalled();
    expect(input.value).toBe("original");
    expect(syncChange).toHaveBeenCalledWith(input);
    input.remove();
  });
});
