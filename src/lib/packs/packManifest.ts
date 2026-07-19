import { PACK_MANIFEST_VERSION, type PackManifest } from "../../types/pack";

const PACK_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SEMVER_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?$/;

/** Kebab-case pack / author / contribution id (`my-pack`). */
export function isPackId(value: string): boolean {
  return PACK_ID_PATTERN.test(value);
}

/** Alias — authorId uses the same kebab rules as packId. */
export const isAuthorId = isPackId;

/** Alias — contribution ids use the same kebab rules as packId. */
export const isContributionId = isPackId;

/** Permissive semver MAJOR.MINOR.PATCH with optional pre-release / build. */
export function isPackSemver(value: string): boolean {
  return SEMVER_PATTERN.test(value);
}

export class PackManifestError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PackManifestError";
    this.code = code;
  }
}

/** Effective contribution id = `authorId.packId.type.contributionId`. */
export function effectiveContributionId(
  authorId: string,
  packId: string,
  contribType: string,
  contributionId: string,
): string {
  return `${authorId}.${packId}.${contribType}.${contributionId}`;
}

/** Prefix used when remapping settings: `authorId.packId.` */
export function packIdPrefix(authorId: string, packId: string): string {
  return `${authorId}.${packId}.`;
}

/**
 * Slugify free text into a kebab-case id (shared by pack/theme/author defaults).
 */
export function slugifyId(input: string): string {
  let out = "";
  let pendingHyphen = false;
  for (const ch of input) {
    if (/[a-zA-Z0-9]/.test(ch)) {
      if (pendingHyphen && out.length > 0) {
        out += "-";
      }
      pendingHyphen = false;
      out += ch.toLowerCase();
    } else if (out.length > 0) {
      pendingHyphen = true;
    }
  }
  return out.length === 0 ? "untitled" : out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Fail-fast check on `manifestVersion` before full field validation.
 * Unknown or missing versions throw with a clear code/message.
 */
export function assertPackManifestVersion(
  value: unknown,
): asserts value is Record<string, unknown> & {
  manifestVersion: typeof PACK_MANIFEST_VERSION;
} {
  if (!isRecord(value)) {
    throw new PackManifestError(
      "invalid_pack_json",
      "pack.json must be a JSON object",
    );
  }
  if (!("manifestVersion" in value)) {
    throw new PackManifestError(
      "missing_manifest_version",
      "pack.json is missing manifestVersion",
    );
  }
  const manifestVersion = value.manifestVersion;
  if (manifestVersion !== PACK_MANIFEST_VERSION) {
    throw new PackManifestError(
      "unsupported_manifest_version",
      `unsupported pack manifestVersion: ${String(manifestVersion)} (expected ${PACK_MANIFEST_VERSION})`,
    );
  }
}

function requireNonEmptyString(
  obj: Record<string, unknown>,
  key: string,
): string {
  const value = obj[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new PackManifestError(
      "invalid_field",
      `pack.json field "${key}" must be a non-empty string`,
    );
  }
  return value;
}

/**
 * Parse and validate a pack.json value against the v1 contract.
 * Does not load contribution files or check minAppVersion against the app.
 */
export function parsePackManifest(value: unknown): PackManifest {
  assertPackManifestVersion(value);
  const obj = value;

  if ("contributions" in obj) {
    throw new PackManifestError(
      "contributions_not_allowed",
      "pack.json must not declare contributions[] — contributions are discovered by scanning type folders",
    );
  }

  if ("author" in obj && !("authorId" in obj)) {
    throw new PackManifestError(
      "author_renamed",
      "pack.json uses authorId (structured slug), not author (freeform). Contribution manifests keep freeform author.",
    );
  }

  const packId = requireNonEmptyString(obj, "packId");
  if (!PACK_ID_PATTERN.test(packId)) {
    throw new PackManifestError(
      "invalid_pack_id",
      `packId must be a kebab-case slug, got: ${packId}`,
    );
  }

  const authorId = requireNonEmptyString(obj, "authorId");
  if (!PACK_ID_PATTERN.test(authorId)) {
    throw new PackManifestError(
      "invalid_author_id",
      `authorId must be a kebab-case slug, got: ${authorId}`,
    );
  }

  const version = requireNonEmptyString(obj, "version");
  if (!SEMVER_PATTERN.test(version)) {
    throw new PackManifestError(
      "invalid_version",
      `version must be semver, got: ${version}`,
    );
  }

  const name = requireNonEmptyString(obj, "name");
  const description =
    typeof obj.description === "string" ? obj.description : null;
  if (description === null) {
    throw new PackManifestError(
      "invalid_field",
      'pack.json field "description" must be a string',
    );
  }

  let icon: string | undefined;
  if ("icon" in obj && obj.icon !== undefined) {
    if (typeof obj.icon !== "string" || obj.icon.trim().length === 0) {
      throw new PackManifestError(
        "invalid_field",
        'pack.json field "icon" must be a non-empty string when present',
      );
    }
    icon = obj.icon;
  }

  let minAppVersion: string | undefined;
  if ("minAppVersion" in obj && obj.minAppVersion !== undefined) {
    if (
      typeof obj.minAppVersion !== "string" ||
      !SEMVER_PATTERN.test(obj.minAppVersion)
    ) {
      throw new PackManifestError(
        "invalid_min_app_version",
        `minAppVersion must be semver when present, got: ${String(obj.minAppVersion)}`,
      );
    }
    minAppVersion = obj.minAppVersion;
  }

  return {
    manifestVersion: PACK_MANIFEST_VERSION,
    packId,
    authorId,
    version,
    name,
    description,
    ...(icon !== undefined ? { icon } : {}),
    ...(minAppVersion !== undefined ? { minAppVersion } : {}),
  };
}

export function parsePackManifestJson(json: string): PackManifest {
  let value: unknown;
  try {
    value = JSON.parse(json) as unknown;
  } catch (e) {
    throw new PackManifestError(
      "invalid_json",
      `pack.json is not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  return parsePackManifest(value);
}
