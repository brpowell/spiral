import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isSkinDebugEnabled,
  setSkinDebugEnabled,
  SKIN_DEBUG_CHANGE_EVENT,
  SKIN_DEBUG_STORAGE_KEY,
  toggleSkinDebug,
} from "./skinDebug";

describe("skinDebug", () => {
  const storage = new Map<string, string>();
  const listeners = new Map<string, Set<EventListener>>();

  beforeEach(() => {
    storage.clear();
    listeners.clear();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
    });
    vi.stubGlobal("window", {
      dispatchEvent: (event: Event) => {
        listeners.get(event.type)?.forEach((listener) => listener(event));
        return true;
      },
      addEventListener: (type: string, listener: EventListener) => {
        const set = listeners.get(type) ?? new Set();
        set.add(listener);
        listeners.set(type, set);
      },
      removeEventListener: (type: string, listener: EventListener) => {
        listeners.get(type)?.delete(listener);
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults to disabled", () => {
    expect(isSkinDebugEnabled()).toBe(false);
  });

  it("enables via localStorage flag", () => {
    setSkinDebugEnabled(true);
    expect(storage.get(SKIN_DEBUG_STORAGE_KEY)).toBe("1");
    expect(isSkinDebugEnabled()).toBe(true);
  });

  it("toggles and dispatches change event", () => {
    const events: string[] = [];
    window.addEventListener(SKIN_DEBUG_CHANGE_EVENT, () => {
      events.push("changed");
    });

    expect(toggleSkinDebug()).toBe(true);
    expect(isSkinDebugEnabled()).toBe(true);
    expect(events).toEqual(["changed"]);

    expect(toggleSkinDebug()).toBe(false);
    expect(isSkinDebugEnabled()).toBe(false);
  });
});
