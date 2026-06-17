/** Shared presentation atoms for skins and visualizer scene layers. */

export type AudioDriveKey =
  | "audio.overallEnergy"
  | "audio.bassEnergy"
  | "audio.midEnergy"
  | "audio.trebleEnergy"
  | "audio.volume";

/** Drive source: audio bucket, skin bind path, or static value. */
export type DriveSource = AudioDriveKey | string;

/**
 * Binds a layer property to a dynamic source.
 * String sugar: `"audio.bassEnergy"`. Structured form supports remap ranges.
 */
export type DriveBinding =
  | number
  | string
  | {
      drive: DriveSource;
      map?: [number, number, number, number];
      value?: number;
    };

export type PresentationEventName =
  | "track.changed"
  | "player.playbackState";

export interface PresentationTrigger {
  on: PresentationEventName | string;
  clip?: string;
}

export type TransformDriveKey =
  | "opacity"
  | "scale"
  | "translateX"
  | "translateY"
  | "rotation";

export type LayerDriveMap = Partial<Record<TransformDriveKey, DriveBinding>>;
