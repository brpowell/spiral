/** MusicBrainz pseudo-area codes that are not ISO 3166-1 alpha-2. */
const MUSICBRAINZ_SPECIAL_FLAGS: Record<string, string> = {
  XE: "🇪🇺",
  XW: "🌐",
};

/** Convert an ISO 3166-1 alpha-2 or MusicBrainz area code to a flag emoji, if possible. */
export function countryFlagEmoji(countryCode: string): string | null {
  const code = countryCode.trim().toUpperCase();
  if (!code) return null;

  const special = MUSICBRAINZ_SPECIAL_FLAGS[code];
  if (special) return special;

  if (!/^[A-Z]{2}$/.test(code)) return null;
  // MusicBrainz uses X-prefixed pseudo-area codes (XU, XJ, …) that are not countries.
  if (code.startsWith("X")) return null;

  const base = 0x1f1e6;
  const asciiA = "A".charCodeAt(0);
  return String.fromCodePoint(
    ...code.split("").map((char) => base + (char.charCodeAt(0) - asciiA)),
  );
}

export function formatCountryDisplay(countryCode: string): string {
  const code = countryCode.trim().toUpperCase();
  const flag = countryFlagEmoji(code);
  return flag ? `${flag} ${code}` : code;
}
