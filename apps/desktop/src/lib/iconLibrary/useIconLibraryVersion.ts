import { useSyncExternalStore } from "react";
import { getIconLibraryVersion, subscribeIconLibrary } from "./registry";

/** Re-render when any icon's tags change; use as a memo dependency. */
export function useIconLibraryVersion(): number {
  return useSyncExternalStore(
    subscribeIconLibrary,
    getIconLibraryVersion,
    getIconLibraryVersion,
  );
}
