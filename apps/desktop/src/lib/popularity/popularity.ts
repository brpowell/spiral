import type { Track, TrackId } from "@/types/track";

/**
 * Popularity building blocks.
 *
 * The backend scores individual tracks (`getTrackPopularity`). Everything here is pure and works
 * on any group of tracks, so albums, artists, genres, playlists, decades and so on all roll up
 * the same way. Scores are not normalized: they are comparable within one profile, and zero means
 * "no listening signal".
 */

/** Track id -> score. Absent means 0. */
export type TrackScores = ReadonlyMap<TrackId, number>;

export interface PopularityParams {
  /** Days for a listen's weight to halve. `null` disables decay (all-time totals). */
  halfLifeDays?: number | null;
  /** Ignore listens older than this many days. */
  windowDays?: number | null;
  /** Weight subtracted for a short listen that ended in a skip. */
  skipPenalty?: number;
  /** Multiplier for each further same-day positive listen of one track. `1` turns it off. */
  repeatFalloff?: number;
}

export interface TrackPopularityRow {
  trackId: TrackId;
  score: number;
}

export function toTrackScores(
  rows: readonly TrackPopularityRow[],
): TrackScores {
  return new Map(rows.map((row) => [row.trackId, row.score]));
}

/**
 * How each track's score is eased before aggregating, so a single obsessively replayed track
 * can't carry a whole album or artist.
 */
export type ScoreCompression = "none" | "sqrt" | "log";

export interface AggregateOptions {
  /**
   * - `sum`: total of the tracks' scores (favours big groups).
   * - `mean`: total divided by every track in the group, unplayed ones included (favours groups
   *   listened to as a whole).
   * - `top`: total of the `n` highest-scoring tracks (a big back catalog doesn't win on volume).
   */
  strategy?: "sum" | "mean" | "top";
  /** Track count for `strategy: "top"`. Defaults to 10. */
  n?: number;
  /** Defaults to `sqrt`. */
  compression?: ScoreCompression;
}

const DEFAULT_TOP_N = 10;

function compress(score: number, compression: ScoreCompression): number {
  if (score <= 0) return 0;
  switch (compression) {
    case "none":
      return score;
    case "sqrt":
      return Math.sqrt(score);
    case "log":
      return Math.log1p(score);
  }
}

/** Roll the scores of a group of tracks up into one number. An empty group scores 0. */
export function aggregateScores(
  tracks: readonly Pick<Track, "id">[],
  scores: TrackScores,
  options: AggregateOptions = {},
): number {
  const { strategy = "sum", n = DEFAULT_TOP_N, compression = "sqrt" } = options;
  if (tracks.length === 0) return 0;

  const eased = tracks.map((track) =>
    compress(scores.get(track.id) ?? 0, compression),
  );

  switch (strategy) {
    case "sum":
      return eased.reduce((total, value) => total + value, 0);
    case "mean":
      return eased.reduce((total, value) => total + value, 0) / eased.length;
    case "top":
      return [...eased]
        .sort((a, b) => b - a)
        .slice(0, Math.max(0, n))
        .reduce((total, value) => total + value, 0);
  }
}

/**
 * Map a score onto 0..1 for drawing, relative to the highest score in the same profile. The
 * square root keeps mid-range tracks visible while a few heavily played ones sit at the top.
 */
export function popularityFraction(score: number, topScore: number): number {
  if (!(score > 0) || !(topScore > 0)) return 0;
  return Math.sqrt(Math.min(1, score / topScore));
}

export interface Ranked<T> {
  item: T;
  score: number;
}

/**
 * Items with a positive score, highest first. Ties keep their input order, so callers can
 * pre-sort by title and get a stable result. Items nobody has listened to are left out; take
 * `ranked[0]?.item` for "the most popular, if there is one".
 */
export function rankByScore<T>(
  items: readonly T[],
  scoreOf: (item: T) => number,
): Ranked<T>[] {
  return items
    .map((item, index) => ({ item, score: scoreOf(item), index }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ item, score }) => ({ item, score }));
}
