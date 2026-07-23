import { getConvertProfileOptions } from "./tauri";
import { audioExtensionFromPath } from "./supportedAudio";

export type EncodingProfileId =
  | "lossless-flac"
  | "apple-alac"
  | "apple-aac"
  | "mp3-high"
  | "mp3-compact";

export interface EncodingProfile {
  id: EncodingProfileId;
  label: string;
  subtitle: string;
  extension: string;
}

export const BUILTIN_ENCODING_PROFILES: readonly EncodingProfile[] = [
  {
    id: "lossless-flac",
    label: "Lossless (FLAC)",
    subtitle: "Best quality for your library",
    extension: "flac",
  },
  {
    id: "apple-alac",
    label: "Apple Lossless (ALAC)",
    subtitle: "Lossless quality for Apple devices",
    extension: "m4a",
  },
  {
    id: "apple-aac",
    label: "Apple Device (AAC)",
    subtitle: ".m4a for iPod, iPhone, and iTunes",
    extension: "m4a",
  },
  {
    id: "mp3-high",
    label: "MP3 - High (320)",
    subtitle: "Works on almost any player",
    extension: "mp3",
  },
  {
    id: "mp3-compact",
    label: "MP3 - Compact (128)",
    subtitle: "Smaller files, more songs per device",
    extension: "mp3",
  },
] as const;

export const DEFAULT_CD_IMPORT_PROFILE_ID: EncodingProfileId = "lossless-flac";

export const ENCODING_PROFILE_SELECT_OPTIONS = BUILTIN_ENCODING_PROFILES.map(
  (profile) => ({
    value: profile.id,
    label: profile.label,
    description: profile.subtitle,
  }),
);

export type EncodingProfileSelectOption =
  (typeof ENCODING_PROFILE_SELECT_OPTIONS)[number];

const profileById = new Map(
  BUILTIN_ENCODING_PROFILES.map((profile) => [profile.id, profile]),
);

export function getEncodingProfile(id: string): EncodingProfile | undefined {
  return profileById.get(id as EncodingProfileId);
}

export function isKnownEncodingProfileId(id: string): boolean {
  return profileById.has(id as EncodingProfileId);
}

/** Label for the source file's inferred or probed encoding profile. */
export function formatSourceEncodingProfileLabel(options: {
  sourceProfileId?: string | null;
  codec?: string | null;
}): string | null {
  if (options.sourceProfileId) {
    const builtin = getEncodingProfile(options.sourceProfileId);
    if (builtin) return builtin.label;
  }
  if (options.codec?.trim().toLowerCase() === "alac") {
    return "Apple Lossless (ALAC)";
  }
  return null;
}

function profileIsLosslessFallback(profileId: string): boolean {
  return profileId === "lossless-flac" || profileId === "apple-alac";
}

function sourceIsLosslessFallback(sourcePath: string): boolean {
  const ext = audioExtensionFromPath(sourcePath);
  return ext === "flac" || ext === "wav";
}

function inferEncodingProfileIdFromPath(
  path: string,
): EncodingProfileId | undefined {
  const ext = audioExtensionFromPath(path);
  if (ext === "flac") return "lossless-flac";
  if (ext === "m4a") return "apple-aac";
  return undefined;
}

/** Extension-only fallback when the backend probe is unavailable. */
function canConvertSourceToProfileFallback(
  sourcePath: string,
  profileId: string,
): boolean {
  const sourceProfile = inferEncodingProfileIdFromPath(sourcePath);
  if (sourceProfile === profileId) return false;
  if (
    profileIsLosslessFallback(profileId) &&
    !sourceIsLosslessFallback(sourcePath)
  ) {
    return false;
  }
  return true;
}

export function encodingProfileOptionsForConvert(sourcePaths: readonly string[]) {
  return ENCODING_PROFILE_SELECT_OPTIONS.filter((option) =>
    sourcePaths.every((path) =>
      canConvertSourceToProfileFallback(path, option.value),
    ),
  );
}

export async function loadConvertProfileOptions(sourcePaths: readonly string[]) {
  try {
    const options = await getConvertProfileOptions([...sourcePaths]);
    const profileOptions = ENCODING_PROFILE_SELECT_OPTIONS.filter((option) =>
      options.profileIds.includes(option.value),
    );
    const defaultProfileId = isKnownEncodingProfileId(options.defaultProfileId)
      ? (options.defaultProfileId as EncodingProfileId)
      : (profileOptions[0]?.value as EncodingProfileId | undefined);

    return {
      profileOptions,
      defaultProfileId,
      sourceProfileId: options.sourceProfileId ?? null,
    };
  } catch (err) {
    console.warn("get_convert_profile_options failed; using extension fallback", err);
    const profileOptions = encodingProfileOptionsForConvert(sourcePaths);
    return {
      profileOptions,
      defaultProfileId: inferDefaultConvertProfileId(sourcePaths[0] ?? ""),
      sourceProfileId: null,
    };
  }
}

export function inferDefaultConvertProfileId(sourcePath: string): EncodingProfileId {
  const currentProfile = inferEncodingProfileIdFromPath(sourcePath);

  const allowedProfiles = BUILTIN_ENCODING_PROFILES.filter((profile) =>
    canConvertSourceToProfileFallback(sourcePath, profile.id),
  );

  const fallback =
    allowedProfiles.find((profile) => profile.id !== currentProfile)?.id ??
    allowedProfiles[0]?.id ??
    "apple-aac";
  return fallback;
}
