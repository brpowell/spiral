const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SEMVER_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?$/;

/** Kebab-case id (`my-item`): item ids and publisher ids share these rules. */
export function isSlug(value: string): boolean {
  return SLUG_PATTERN.test(value);
}

/** Alias: `publisherId` uses the same kebab rules as an item `id`. */
export const isPublisherId = isSlug;

/** Permissive semver MAJOR.MINOR.PATCH with optional pre-release / build. */
export function isSemver(value: string): boolean {
  return SEMVER_PATTERN.test(value);
}

/** Slugify free text into a kebab-case id (item, theme and publisher defaults). */
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
