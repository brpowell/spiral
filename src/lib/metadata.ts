import { invoke } from "@tauri-apps/api/core";
import type { TrackInput } from "../types/track";

export async function parseTrackMetadata(filePath: string): Promise<TrackInput> {
  return invoke<TrackInput>("parse_track_metadata", { filePath });
}
