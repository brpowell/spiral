import type { MusicBrainzTrackSlot } from "../types/musicbrainz";
import { parseOptionalInt } from "./albumMetadata";
import { getMusicBrainzEntity } from "./tauri";

type RecordingMatchTrack = {
  discNumber?: number | null;
  trackNumber?: number | null;
};

/**
 * Match a library track to a release tracklist slot by disc + track position.
 * Missing discNumber is treated as 1. Ambiguous or missing slots → null.
 */
export function matchRecordingMbid(
  track: RecordingMatchTrack,
  slots: readonly MusicBrainzTrackSlot[],
): string | null {
  if (track.trackNumber == null || !Number.isFinite(track.trackNumber)) {
    return null;
  }
  const discNumber =
    track.discNumber != null && Number.isFinite(track.discNumber)
      ? track.discNumber
      : 1;
  const trackNumber = track.trackNumber;
  const matches = slots.filter(
    (slot) =>
      slot.discNumber === discNumber && slot.trackNumber === trackNumber,
  );
  if (matches.length !== 1) return null;
  return matches[0].recordingMbid?.trim() || null;
}

/**
 * When track/disc numbers change and the album release is cached, rematch the
 * recording MBID locally (no network). Returns `undefined` to leave the
 * existing recording alone (no release, or cold cache).
 */
export async function rematchRecordingFromCachedRelease(options: {
  releaseMbid?: string | null;
  discNumberForm: string;
  trackNumberForm: string;
  numbersChanged: boolean;
}): Promise<string | null | undefined> {
  if (!options.numbersChanged) return undefined;
  const result = await deriveRecordingFromCachedRelease(options);
  if (result.status === "matched") return result.recordingMbid;
  if (result.status === "unmatched") return null;
  return undefined;
}

type DeriveRecordingResult =
  | { status: "noRelease" }
  | { status: "cacheMiss" }
  | { status: "unmatched" }
  | { status: "matched"; recordingMbid: string };

/**
 * Resolve a recording MBID from a cached release tracklist (no network).
 * Used when the album already has a release but the track was never stamped.
 */
export async function deriveRecordingFromCachedRelease(options: {
  releaseMbid?: string | null;
  discNumberForm: string;
  trackNumberForm: string;
  discNumber?: number | null;
  trackNumber?: number | null;
}): Promise<DeriveRecordingResult> {
  const releaseMbid = options.releaseMbid?.trim();
  if (!releaseMbid) return { status: "noRelease" };
  const cached = await getMusicBrainzEntity("release", releaseMbid);
  const tracklist = cached?.tracklist;
  if (tracklist == null || tracklist.length === 0) {
    return { status: "cacheMiss" };
  }
  const matched = matchRecordingMbid(
    {
      discNumber:
        options.discNumber !== undefined
          ? options.discNumber
          : parseOptionalInt(options.discNumberForm),
      trackNumber:
        options.trackNumber !== undefined
          ? options.trackNumber
          : parseOptionalInt(options.trackNumberForm),
    },
    tracklist,
  );
  if (matched == null) return { status: "unmatched" };
  return { status: "matched", recordingMbid: matched };
}
