import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { SkinClickEffect } from "../types/skin";
import type { SkinBindState } from "./skinBinds";
import { scheduleSkinEffects } from "./skinEffects";
import { SKIN_HOVER_RESIZE_QUIET_MS } from "./skinHover";

const LEAVE_DELAY_MS = 50;

interface SkinHoverApi {
  active: ReadonlySet<string>;
  enter: (ids: string[], token: string) => void;
  leave: (ids: string[], token: string) => void;
  /** Drop occupancy now (hide / unmount). Unlike `leave`, skips the move grace. */
  release: (ids: string[], token: string) => void;
}

const EMPTY_ACTIVE: ReadonlySet<string> = new Set();

const SkinHoverContext = createContext<SkinHoverApi>({
  active: EMPTY_ACTIVE,
  enter: () => {},
  leave: () => {},
  release: () => {},
});

function idsEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) {
    if (!b.has(id)) return false;
  }
  return true;
}

function subscribeWindowResized(onResize: () => void): () => void {
  window.addEventListener("resize", onResize);
  let unlistenTauri: (() => void) | undefined;
  let cancelled = false;
  try {
    void getCurrentWindow()
      .onResized(onResize)
      .then((fn) => {
        if (cancelled) fn();
        else unlistenTauri = fn;
      })
      .catch(() => {});
  } catch {
    // vitest / non-Tauri
  }
  return () => {
    cancelled = true;
    window.removeEventListener("resize", onResize);
    unlistenTauri?.();
  };
}

export function SkinHoverProvider({ children }: { children: ReactNode }) {
  const tokensById = useRef(new Map<string, Set<string>>());
  const leaveTimers = useRef(new Map<string, number>());
  const resizeSuppressed = useRef(false);
  const resizeQuietTimer = useRef<number | undefined>(undefined);
  const [active, setActive] = useState<ReadonlySet<string>>(EMPTY_ACTIVE);

  const syncActive = useCallback(() => {
    const next = new Set<string>();
    for (const [id, tokens] of tokensById.current) {
      if (tokens.size > 0 || leaveTimers.current.has(id)) next.add(id);
    }
    setActive((prev) => (idsEqual(prev, next) ? prev : next));
  }, []);

  const beginResizeQuiet = useCallback(() => {
    resizeSuppressed.current = true;
    tokensById.current.clear();
    for (const timer of leaveTimers.current.values()) {
      window.clearTimeout(timer);
    }
    leaveTimers.current.clear();
    setActive((prev) => (prev.size === 0 ? prev : EMPTY_ACTIVE));
    if (resizeQuietTimer.current !== undefined) {
      window.clearTimeout(resizeQuietTimer.current);
    }
    resizeQuietTimer.current = window.setTimeout(() => {
      resizeQuietTimer.current = undefined;
      resizeSuppressed.current = false;
    }, SKIN_HOVER_RESIZE_QUIET_MS);
  }, []);

  useEffect(() => {
    const timers = leaveTimers.current;
    const stopResize = subscribeWindowResized(beginResizeQuiet);
    return () => {
      stopResize();
      if (resizeQuietTimer.current !== undefined) {
        window.clearTimeout(resizeQuietTimer.current);
      }
      for (const timer of timers.values()) {
        window.clearTimeout(timer);
      }
      timers.clear();
    };
  }, [beginResizeQuiet]);

  const enter = useCallback(
    (ids: string[], token: string) => {
      if (resizeSuppressed.current) return;
      let changed = false;
      for (const id of ids) {
        const timer = leaveTimers.current.get(id);
        if (timer !== undefined) {
          window.clearTimeout(timer);
          leaveTimers.current.delete(id);
          changed = true;
        }
        let tokens = tokensById.current.get(id);
        if (!tokens) {
          tokens = new Set();
          tokensById.current.set(id, tokens);
        }
        if (!tokens.has(token)) {
          tokens.add(token);
          changed = true;
        }
      }
      if (changed) syncActive();
    },
    [syncActive],
  );

  const leave = useCallback(
    (ids: string[], token: string) => {
      for (const id of ids) {
        tokensById.current.get(id)?.delete(token);
        if ((tokensById.current.get(id)?.size ?? 0) > 0) {
          const timer = leaveTimers.current.get(id);
          if (timer !== undefined) {
            window.clearTimeout(timer);
            leaveTimers.current.delete(id);
          }
          continue;
        }
        if (leaveTimers.current.has(id)) continue;
        const timer = window.setTimeout(() => {
          leaveTimers.current.delete(id);
          syncActive();
        }, LEAVE_DELAY_MS);
        leaveTimers.current.set(id, timer);
      }
      syncActive();
    },
    [syncActive],
  );

  const release = useCallback(
    (ids: string[], token: string) => {
      for (const id of ids) {
        tokensById.current.get(id)?.delete(token);
        if ((tokensById.current.get(id)?.size ?? 0) > 0) continue;
        const timer = leaveTimers.current.get(id);
        if (timer !== undefined) {
          window.clearTimeout(timer);
          leaveTimers.current.delete(id);
        }
        tokensById.current.delete(id);
      }
      syncActive();
    },
    [syncActive],
  );

  const value = useMemo(
    () => ({ active, enter, leave, release }),
    [active, enter, leave, release],
  );

  return (
    <SkinHoverContext.Provider value={value}>
      {children}
    </SkinHoverContext.Provider>
  );
}

export function useSkinHoveredNodeIds(): ReadonlySet<string> {
  return useContext(SkinHoverContext).active;
}

export function useSkinHoverPointerHandlers(
  ids: string[],
  token: string,
  active = true,
):
  | {
      onPointerEnter: () => void;
      onPointerLeave: () => void;
    }
  | undefined {
  const { enter, leave, release } = useContext(SkinHoverContext);
  const occupancyRef = useRef({ ids, token });
  occupancyRef.current = { ids, token };

  useEffect(() => {
    if (!active && ids.length > 0) {
      release(ids, token);
    }
  }, [active, ids, release, token]);

  useEffect(() => {
    return () => {
      const { ids: currentIds, token: currentToken } = occupancyRef.current;
      if (currentIds.length > 0) release(currentIds, currentToken);
    };
  }, [release]);

  return useMemo(() => {
    if (ids.length === 0 || !active) return undefined;
    return {
      onPointerEnter: () => enter(ids, token),
      onPointerLeave: () => leave(ids, token),
    };
  }, [active, enter, ids, leave, token]);
}

/** Dispatch `onHoverLeave` when `hover.{nodeId}` goes false. */
export function useSkinHoverLeaveEffects(
  nodeId: string | undefined,
  effects: SkinClickEffect[] | undefined,
  getBindState: () => SkinBindState,
): void {
  const hoveredIds = useSkinHoveredNodeIds();
  const hovered = !!(nodeId && hoveredIds.has(nodeId));
  const wasHoveredRef = useRef(false);
  const effectsRef = useRef(effects);
  const getBindStateRef = useRef(getBindState);
  effectsRef.current = effects;
  getBindStateRef.current = getBindState;

  useEffect(() => {
    const wasHovered = wasHoveredRef.current;
    wasHoveredRef.current = hovered;
    if (!wasHovered || hovered || !effectsRef.current?.length) return;
    return scheduleSkinEffects(effectsRef.current, () =>
      getBindStateRef.current(),
    );
  }, [hovered]);
}
