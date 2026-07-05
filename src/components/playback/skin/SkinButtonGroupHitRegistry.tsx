import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

const ELEVATION_DELTA = 1;
const CO_ELEVATION_DELTA = 2;

export interface SkinButtonGroupHitEntry {
  nodeId: string;
  /** Co-elevate above the primary group when any listed node id is active. */
  elevateWhen?: string[];
  sampleKeyAt: (clientX: number, clientY: number) => string | null;
  setHoveredKey: (key: string | null) => void;
  startPress: (key: string, event: ReactPointerEvent<HTMLButtonElement>) => void;
  finishPress: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}

export function resolveButtonGroupPrimaryNodeId(
  pressedNodeId: string | null,
  hoverNodeId: string | null,
): string | null {
  return pressedNodeId ?? hoverNodeId;
}

function computeElevationDeltas(
  entries: Map<string, SkinButtonGroupHitEntry>,
  primaryNodeId: string | null,
): ReadonlyMap<string, number> {
  if (!primaryNodeId) return new Map();

  const deltas = new Map<string, number>([[primaryNodeId, ELEVATION_DELTA]]);

  for (const [nodeId, entry] of entries) {
    if (entry.elevateWhen?.includes(primaryNodeId)) {
      deltas.set(nodeId, CO_ELEVATION_DELTA);
    }
  }

  return deltas;
}

function elevationDeltasEqual(
  a: ReadonlyMap<string, number>,
  b: ReadonlyMap<string, number>,
): boolean {
  if (a.size !== b.size) return false;
  for (const [key, value] of a) {
    if (b.get(key) !== value) return false;
  }
  return true;
}

export interface ResolvedButtonGroupHit {
  entry: SkinButtonGroupHitEntry;
  key: string;
}

interface SkinButtonGroupHitRegistryValue {
  register: (entry: SkinButtonGroupHitEntry) => () => void;
  resolveHitAt: (
    clientX: number,
    clientY: number,
  ) => ResolvedButtonGroupHit | null;
  syncHoverAt: (clientX: number, clientY: number) => void;
  setPressedNodeId: (nodeId: string | null) => void;
  elevationDeltas: ReadonlyMap<string, number>;
}

const SkinButtonGroupHitRegistryContext =
  createContext<SkinButtonGroupHitRegistryValue | null>(null);

export function SkinButtonGroupHitRegistryProvider({
  children,
}: {
  children: ReactNode;
}) {
  const entriesRef = useRef(new Map<string, SkinButtonGroupHitEntry>());
  const pressedNodeIdRef = useRef<string | null>(null);
  const hoverNodeIdRef = useRef<string | null>(null);
  const [elevationDeltas, setElevationDeltas] = useState<
    ReadonlyMap<string, number>
  >(() => new Map());

  const applyPrimaryElevation = useCallback(() => {
    const primaryNodeId = resolveButtonGroupPrimaryNodeId(
      pressedNodeIdRef.current,
      hoverNodeIdRef.current,
    );
    setElevationDeltas((prev) => {
      const next = computeElevationDeltas(entriesRef.current, primaryNodeId);
      return elevationDeltasEqual(prev, next) ? prev : next;
    });
  }, []);

  const register = useCallback((entry: SkinButtonGroupHitEntry) => {
    entriesRef.current.set(entry.nodeId, entry);
    return () => {
      entriesRef.current.delete(entry.nodeId);
    };
  }, []);

  const resolveHitAt = useCallback(
    (clientX: number, clientY: number): ResolvedButtonGroupHit | null => {
      let element = document.elementFromPoint(clientX, clientY);
      const visited = new Set<string>();

      while (element instanceof HTMLElement) {
        if (!element.classList.contains("skin-button-group__hit")) break;

        const nodeId = element.getAttribute("data-node-id");
        if (!nodeId || visited.has(nodeId)) break;
        visited.add(nodeId);

        const entry = entriesRef.current.get(nodeId);
        if (!entry) break;

        const key = entry.sampleKeyAt(clientX, clientY);
        if (key) return { entry, key };

        element.style.pointerEvents = "none";
        const below = document.elementFromPoint(clientX, clientY);
        element.style.pointerEvents = "auto";
        element = below instanceof HTMLElement ? below : null;
      }

      return null;
    },
    [],
  );

  const syncHoverAt = useCallback(
    (clientX: number, clientY: number) => {
      const resolved = resolveHitAt(clientX, clientY);
      for (const entry of entriesRef.current.values()) {
        if (resolved && entry.nodeId === resolved.entry.nodeId) {
          entry.setHoveredKey(resolved.key);
        } else {
          entry.setHoveredKey(null);
        }
      }
      hoverNodeIdRef.current = resolved?.entry.nodeId ?? null;
      applyPrimaryElevation();
    },
    [resolveHitAt, applyPrimaryElevation],
  );

  const setPressedNodeId = useCallback(
    (nodeId: string | null) => {
      pressedNodeIdRef.current = nodeId;
      applyPrimaryElevation();
    },
    [applyPrimaryElevation],
  );

  const value = useMemo(
    () => ({
      register,
      resolveHitAt,
      syncHoverAt,
      setPressedNodeId,
      elevationDeltas,
    }),
    [register, resolveHitAt, syncHoverAt, setPressedNodeId, elevationDeltas],
  );

  return (
    <SkinButtonGroupHitRegistryContext.Provider value={value}>
      {children}
    </SkinButtonGroupHitRegistryContext.Provider>
  );
}

export function useSkinButtonGroupHitRegistry():
  | SkinButtonGroupHitRegistryValue
  | null {
  return useContext(SkinButtonGroupHitRegistryContext);
}

export function useButtonGroupElevationDelta(nodeId: string | undefined): number {
  const registry = useContext(SkinButtonGroupHitRegistryContext);
  if (nodeId === undefined || registry === null) return 0;
  return registry.elevationDeltas.get(nodeId) ?? 0;
}
