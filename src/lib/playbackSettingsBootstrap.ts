import { getPlaybackSettings } from "./tauri";
import { usePlaybackSettingsStore } from "../store/usePlaybackSettingsStore";
import { defaultPlaybackSettings } from "../types/playbackSettings";

export async function bootstrapPlaybackSettings(): Promise<void> {
  try {
    const settings = await getPlaybackSettings();
    usePlaybackSettingsStore.getState().initializeFromBootstrap(settings);
  } catch (err) {
    console.error("Playback settings bootstrap failed:", err);
    usePlaybackSettingsStore
      .getState()
      .initializeFromBootstrap(defaultPlaybackSettings());
  }
}
