/**
 * Typo-tolerant, diacritic-insensitive search for library tracks/albums/artists.
 *
 * Every whitespace-separated query token must match the item (AND). A token
 * matches a word exactly, as a word prefix, as a substring, across a word
 * boundary ("bonjovi" ↔ "bon jovi"), or within a small edit distance
 * (transpositions included) of a word or word prefix, so partially-typed
 * misspellings still match while typing.
 *
 * Per-item haystacks are built lazily and cached in a WeakMap keyed by the
 * item, so they are released with the item and each keystroke only scans
 * precomputed strings.
 */

export interface FuzzyHaystack {
  /** Normalized text with all spaces removed. */
  compact: string;
  /** Unique normalized words. */
  words: string[];
  /** Relative importance of a match in this group (1 = full). */
  weight: number;
}

/** Fields that share one weight, e.g. title vs. artist/album. */
export interface FuzzyFieldGroup {
  fields: ReadonlyArray<string | null | undefined>;
  weight?: number;
}

export interface FuzzyQuery {
  tokens: string[];
  /** True when the query is empty and everything matches. */
  empty: boolean;
}

const COMBINING_MARKS = /[̀-ͯ]/g;
const NON_WORD = /[^\p{L}\p{N}]+/gu;

/** Lowercase, strip diacritics, and replace punctuation with single spaces. */
export function normalizeSearchText(input: string): string {
  return input
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(NON_WORD, " ")
    .trim();
}

export function prepareFuzzyQuery(query: string): FuzzyQuery {
  const normalized = normalizeSearchText(query);
  if (!normalized) return { tokens: [], empty: true };
  return { tokens: normalized.split(" "), empty: false };
}

export function buildFuzzyHaystack(
  fields: ReadonlyArray<string | null | undefined>,
  weight = 1,
): FuzzyHaystack {
  const parts: string[] = [];
  for (const field of fields) {
    if (!field) continue;
    const normalized = normalizeSearchText(field);
    if (normalized) parts.push(normalized);
  }
  const text = parts.join(" ");
  return {
    compact: text.replace(/ /g, ""),
    words: Array.from(new Set(text.split(" "))).filter(Boolean),
    weight,
  };
}

/** Max edits tolerated for a token of the given length. */
function maxEdits(len: number): number {
  if (len <= 3) return 0;
  if (len <= 6) return 1;
  return 2;
}

let rowPrev = new Int32Array(64);
let rowPrev2 = new Int32Array(64);
let rowCur = new Int32Array(64);

/**
 * Optimal-string-alignment distance (Levenshtein + adjacent transposition),
 * bounded: returns `max + 1` as soon as the distance must exceed `max`.
 * Reuses module-level rows to avoid per-call allocation.
 */
export function boundedEditDistance(a: string, b: string, max: number): number {
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  if (la === 0) return lb;
  if (lb === 0) return la;
  if (rowPrev.length < lb + 1) {
    const size = lb + 1;
    rowPrev = new Int32Array(size);
    rowPrev2 = new Int32Array(size);
    rowCur = new Int32Array(size);
  }
  let prev2 = rowPrev2;
  let prev = rowPrev;
  let cur = rowCur;
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    cur[0] = i;
    let rowMin = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= lb; j++) {
      const cb = b.charCodeAt(j - 1);
      let v = prev[j - 1] + (ca === cb ? 0 : 1);
      const del = prev[j] + 1;
      if (del < v) v = del;
      const ins = cur[j - 1] + 1;
      if (ins < v) v = ins;
      if (
        i > 1 &&
        j > 1 &&
        ca === b.charCodeAt(j - 2) &&
        a.charCodeAt(i - 2) === cb
      ) {
        const tr = prev2[j - 2] + 1;
        if (tr < v) v = tr;
      }
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    const tmp = prev2;
    prev2 = prev;
    prev = cur;
    cur = tmp;
  }
  return prev[lb];
}

const SCORE_EXACT_WORD = 100;
const SCORE_PREFIX = 85;
const SCORE_SUBSTRING = 60;
const SCORE_COMPACT = 45;
const SCORE_FUZZY_BASE = 40;
/** Shorter tokens would match by accident across word boundaries ("tv" in "point video"). */
const MIN_COMPACT_TOKEN_LENGTH = 4;

/** Score one token against a haystack; 0 means no match. */
function scoreToken(token: string, hay: FuzzyHaystack): number {
  const { words } = hay;
  let best = 0;
  // Tier 1–3: exact / prefix / substring. Stop early on an exact word.
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w === token) return SCORE_EXACT_WORD;
    if (best < SCORE_PREFIX && w.startsWith(token)) {
      best = SCORE_PREFIX;
    } else if (best < SCORE_SUBSTRING && w.includes(token)) {
      best = SCORE_SUBSTRING;
    }
  }
  if (best > 0) return best;
  if (token.length >= MIN_COMPACT_TOKEN_LENGTH && hay.compact.includes(token)) {
    return SCORE_COMPACT;
  }

  const max = maxEdits(token.length);
  if (max === 0) return 0;
  const tl = token.length;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    // Whole-word typo, or typo in a prefix of the word (still typing).
    let d = boundedEditDistance(token, w, max);
    if (d > max && w.length > tl) {
      d = Math.min(d, boundedEditDistance(token, w.slice(0, tl), max));
    }
    if (d <= max) {
      const s = SCORE_FUZZY_BASE - d * 8;
      if (s > best) best = s;
    }
  }
  return best;
}

/**
 * Relevance of an item's field groups for a prepared query: 0 = no match,
 * otherwise the mean per-token score (higher is better). Each token takes its
 * best weighted score across the groups, so tokens may match in different
 * fields (e.g. artist + title).
 */
export function scoreFuzzy(
  query: FuzzyQuery,
  hays: readonly FuzzyHaystack[],
): number {
  if (query.empty) return 1;
  let total = 0;
  for (const token of query.tokens) {
    let best = 0;
    for (const hay of hays) {
      const s = scoreToken(token, hay) * hay.weight;
      if (s > best) best = s;
    }
    if (best === 0) return 0;
    total += best;
  }
  return total / query.tokens.length;
}

/**
 * Create a matcher for items of type `T` with cached haystacks per item.
 * `fields` lists the searchable strings of an item, either as a flat list
 * (one group) or as weighted groups.
 */
export function createFuzzyMatcher<T extends object>(
  fields: (
    item: T,
  ) =>
    ReadonlyArray<string | null | undefined> | ReadonlyArray<FuzzyFieldGroup>,
) {
  const cache = new WeakMap<T, FuzzyHaystack[]>();
  const haystackOf = (item: T): FuzzyHaystack[] => {
    let hays = cache.get(item);
    if (!hays) {
      const spec = fields(item);
      const first = spec[0];
      hays =
        typeof first === "object" && first !== null
          ? (spec as ReadonlyArray<FuzzyFieldGroup>).map((g) =>
              buildFuzzyHaystack(g.fields, g.weight ?? 1),
            )
          : [
              buildFuzzyHaystack(
                spec as ReadonlyArray<string | null | undefined>,
              ),
            ];
      cache.set(item, hays);
    }
    return hays;
  };
  return {
    score: (item: T, query: FuzzyQuery): number =>
      scoreFuzzy(query, haystackOf(item)),
    matches: (item: T, query: string | FuzzyQuery): boolean => {
      const q = typeof query === "string" ? prepareFuzzyQuery(query) : query;
      return scoreFuzzy(q, haystackOf(item)) > 0;
    },
    /** Items matching `query`, best first (stable for ties). */
    rank: (items: readonly T[], query: string): T[] => {
      const q = prepareFuzzyQuery(query);
      if (q.empty) return items as T[];
      const scored: { item: T; score: number; index: number }[] = [];
      for (let i = 0; i < items.length; i++) {
        const score = scoreFuzzy(q, haystackOf(items[i]));
        if (score > 0) scored.push({ item: items[i], score, index: i });
      }
      scored.sort((a, b) => b.score - a.score || a.index - b.index);
      return scored.map((s) => s.item);
    },
    /** Matching items with their relevance score, original order preserved. */
    scored: (
      items: readonly T[],
      query: string,
    ): { item: T; score: number }[] => {
      const q = prepareFuzzyQuery(query);
      const out: { item: T; score: number }[] = [];
      for (const item of items) {
        const score = scoreFuzzy(q, haystackOf(item));
        if (score > 0) out.push({ item, score });
      }
      return out;
    },
    /** Items matching `query`, original order preserved. */
    filter: (items: readonly T[], query: string): T[] => {
      const q = prepareFuzzyQuery(query);
      if (q.empty) return items as T[];
      return items.filter((item) => scoreFuzzy(q, haystackOf(item)) > 0);
    },
  };
}
