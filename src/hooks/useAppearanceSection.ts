import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import {
  APPEARANCE_NAVIGATE_EVENT,
  type AppearanceNavigatePayload,
  type AppearanceSection,
  getStoredAppearanceSection,
  storeAppearanceSection,
} from "../lib/appearanceWindow";

export function useAppearanceSection(): [
  AppearanceSection,
  (section: AppearanceSection) => void,
  string | null,
  () => void,
] {
  const [section, setSection] = useState<AppearanceSection>(
    getStoredAppearanceSection,
  );
  const [focusPackId, setFocusPackId] = useState<string | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    void listen<AppearanceNavigatePayload>(
      APPEARANCE_NAVIGATE_EVENT,
      (event) => {
        setSection(event.payload.section);
        setFocusPackId(event.payload.packId ?? null);
      },
    ).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const setAndStore = (next: AppearanceSection) => {
    setSection(next);
    storeAppearanceSection(next);
  };

  const clearFocusPackId = () => setFocusPackId(null);

  return [section, setAndStore, focusPackId, clearFocusPackId];
}
