//! Per-track popularity: a time-decayed score computed on demand from `listen_events`.
//!
//! This is a building block, not a finished metric. It answers one question, "how much has this
//! track been listened to, weighting recent listens more", and leaves everything else (album and
//! artist roll-ups, ranking, normalization) to callers. Nothing is stored, so any half-life works
//! without a migration, and clearing listen history is reflected immediately.
//!
//! The score for a track is the sum over its listen events of
//! `weight(event) * 0.5^(age_days / half_life_days)`:
//!
//! - a completed listen weighs 1.0;
//! - a listen that counted as a play but was cut short weighs `listened / duration`, clamped to
//!   `[0.5, 1.0]` (0.5 when the duration is unknown);
//! - a short listen that ended in a skip weighs `-skip_penalty`;
//! - anything else (a brief interruption) weighs nothing.
//!
//! Repeats are damped so one track on loop can't dominate: within one UTC day the n-th positive
//! listen of a track is scaled by `repeat_falloff^(n - 1)`. The final score is floored at zero.

use crate::db::listen_qualifies;
use crate::ids::TrackId;
use chrono::{DateTime, Utc};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

const SECONDS_PER_DAY: f64 = 86_400.0;

/// Tunables for [`track_popularity`]. Every field has a default, so callers send only what they
/// want to change.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PopularityParams {
    /// Days for a listen's weight to halve. `None` disables decay (all-time totals).
    pub half_life_days: Option<f64>,
    /// Ignore listens older than this many days. `None` considers all history.
    pub window_days: Option<f64>,
    /// Weight subtracted for a short listen that ended in a skip. `0.0` ignores skips.
    pub skip_penalty: f64,
    /// Multiplier applied to each further positive listen of the same track on the same UTC day.
    /// `1.0` turns damping off.
    pub repeat_falloff: f64,
}

impl Default for PopularityParams {
    fn default() -> Self {
        Self {
            half_life_days: Some(90.0),
            window_days: None,
            skip_penalty: 0.25,
            repeat_falloff: 0.5,
        }
    }
}

/// One track's score. Tracks with no positive score are omitted from results; treat absent as 0.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackPopularity {
    pub track_id: TrackId,
    pub score: f64,
}

/// The fields of a stored listen that scoring needs.
#[derive(Debug, Clone)]
pub struct ListenSample {
    pub track_id: TrackId,
    pub ended_at: DateTime<Utc>,
    pub listened_seconds: f64,
    pub track_duration_seconds: Option<f64>,
    pub completion: String,
}

/// Undamped, undecayed weight of one listen. See the module docs for the rules.
pub fn event_weight(sample: &ListenSample, skip_penalty: f64) -> f64 {
    if sample.completion == "natural_end" {
        return 1.0;
    }
    if listen_qualifies(
        &sample.completion,
        sample.listened_seconds,
        sample.track_duration_seconds,
    ) {
        return match sample.track_duration_seconds {
            Some(duration) if duration > 0.0 => {
                (sample.listened_seconds / duration).clamp(0.5, 1.0)
            }
            _ => 0.5,
        };
    }
    if sample.completion == "skipped" {
        return -skip_penalty;
    }
    0.0
}

fn decay_factor(age_days: f64, half_life_days: Option<f64>) -> f64 {
    match half_life_days {
        Some(half_life) if half_life > 0.0 => 0.5_f64.powf(age_days.max(0.0) / half_life),
        _ => 1.0,
    }
}

/// Score every track that has at least one sample. Pure: no I/O, `now` is passed in.
pub fn score_samples(
    mut samples: Vec<ListenSample>,
    now: DateTime<Utc>,
    params: &PopularityParams,
) -> HashMap<TrackId, f64> {
    samples.sort_by_key(|s| s.ended_at);

    let mut totals: HashMap<TrackId, f64> = HashMap::new();
    let mut positives_today: HashMap<(TrackId, chrono::NaiveDate), u32> = HashMap::new();

    for sample in &samples {
        let age_days = (now - sample.ended_at).num_milliseconds() as f64 / 1000.0 / SECONDS_PER_DAY;
        if params.window_days.is_some_and(|window| age_days > window) {
            continue;
        }

        let mut weight = event_weight(sample, params.skip_penalty);
        if weight > 0.0 {
            let seen = positives_today
                .entry((sample.track_id.clone(), sample.ended_at.date_naive()))
                .or_insert(0);
            weight *= params.repeat_falloff.powi(*seen as i32);
            *seen += 1;
        }

        *totals.entry(sample.track_id.clone()).or_insert(0.0) +=
            weight * decay_factor(age_days, params.half_life_days);
    }

    for score in totals.values_mut() {
        *score = score.max(0.0);
    }
    totals
}

fn parse_time(raw: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(raw)
        .ok()
        .map(|t| t.with_timezone(&Utc))
}

/// Score tracks from the stored listen history, highest first (ties by track id).
///
/// A track with a legacy `play_count` but no stored events at all (history recording was off, or
/// the counter predates the event log) is scored as `play_count` completed listens at
/// `last_played_at`, so it isn't treated as never played.
pub fn track_popularity(
    conn: &Connection,
    params: &PopularityParams,
    now: DateTime<Utc>,
) -> Result<Vec<TrackPopularity>, rusqlite::Error> {
    let mut samples = Vec::new();

    let mut events = conn.prepare(
        "SELECT track_id, ended_at, listened_seconds, track_duration_seconds, completion
         FROM listen_events",
    )?;
    let rows = events.query_map([], |row| {
        Ok((
            row.get::<_, TrackId>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, f64>(2)?,
            row.get::<_, Option<f64>>(3)?,
            row.get::<_, String>(4)?,
        ))
    })?;
    for row in rows {
        let (track_id, ended_at, listened_seconds, track_duration_seconds, completion) = row?;
        let Some(ended_at) = parse_time(&ended_at) else {
            continue;
        };
        samples.push(ListenSample {
            track_id,
            ended_at,
            listened_seconds,
            track_duration_seconds,
            completion,
        });
    }

    let mut scores = score_samples(samples, now, params);

    let mut legacy = conn.prepare(
        "SELECT id, play_count, last_played_at FROM tracks
         WHERE play_count > 0 AND last_played_at IS NOT NULL
           AND id NOT IN (SELECT DISTINCT track_id FROM listen_events)",
    )?;
    let rows = legacy.query_map(params![], |row| {
        Ok((
            row.get::<_, TrackId>(0)?,
            row.get::<_, u32>(1)?,
            row.get::<_, String>(2)?,
        ))
    })?;
    for row in rows {
        let (track_id, play_count, last_played_at) = row?;
        let Some(last_played) = parse_time(&last_played_at) else {
            continue;
        };
        let age_days = (now - last_played).num_milliseconds() as f64 / 1000.0 / SECONDS_PER_DAY;
        if params.window_days.is_some_and(|window| age_days > window) {
            continue;
        }
        scores.insert(
            track_id,
            f64::from(play_count) * decay_factor(age_days, params.half_life_days),
        );
    }

    let mut out: Vec<TrackPopularity> = scores
        .into_iter()
        .filter(|(_, score)| *score > 0.0)
        .map(|(track_id, score)| TrackPopularity { track_id, score })
        .collect();
    out.sort_by(|a, b| {
        b.score
            .total_cmp(&a.score)
            .then_with(|| a.track_id.cmp(&b.track_id))
    });
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ids::EventId;
    use chrono::Duration;

    /// A readable test id.
    fn tid(n: i64) -> TrackId {
        TrackId::from(n.to_string().as_str())
    }

    fn now() -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-11-16T12:00:00Z")
            .unwrap()
            .with_timezone(&Utc)
    }

    fn sample(track_id: i64, days_ago: f64, completion: &str, listened: f64) -> ListenSample {
        ListenSample {
            track_id: tid(track_id),
            ended_at: now() - Duration::milliseconds((days_ago * SECONDS_PER_DAY * 1000.0) as i64),
            listened_seconds: listened,
            track_duration_seconds: Some(200.0),
            completion: completion.into(),
        }
    }

    fn no_decay() -> PopularityParams {
        PopularityParams {
            half_life_days: None,
            repeat_falloff: 1.0,
            ..PopularityParams::default()
        }
    }

    fn approx(a: f64, b: f64) {
        assert!((a - b).abs() < 1e-6, "{a} != {b}");
    }

    #[test]
    fn event_weight_follows_completion_rules() {
        approx(
            event_weight(&sample(1, 0.0, "natural_end", 200.0), 0.25),
            1.0,
        );
        // 150 of 200s: qualifies (>= 30s), ratio 0.75.
        approx(event_weight(&sample(1, 0.0, "skipped", 150.0), 0.25), 0.75);
        // 40 of 200s: qualifies on seconds, ratio 0.2 clamps up to 0.5.
        approx(event_weight(&sample(1, 0.0, "skipped", 40.0), 0.25), 0.5);
        // 5s skip does not qualify.
        approx(event_weight(&sample(1, 0.0, "skipped", 5.0), 0.25), -0.25);
        // A short interruption is neutral.
        approx(event_weight(&sample(1, 0.0, "interrupted", 5.0), 0.25), 0.0);
    }

    #[test]
    fn unknown_duration_weighs_half_when_qualified_by_seconds() {
        let mut s = sample(1, 0.0, "skipped", 45.0);
        s.track_duration_seconds = None;
        approx(event_weight(&s, 0.25), 0.5);
    }

    #[test]
    fn half_life_halves_an_old_listen() {
        let params = PopularityParams {
            half_life_days: Some(30.0),
            repeat_falloff: 1.0,
            ..PopularityParams::default()
        };
        let scores = score_samples(
            vec![
                sample(1, 0.0, "natural_end", 200.0),
                sample(2, 30.0, "natural_end", 200.0),
                sample(3, 60.0, "natural_end", 200.0),
            ],
            now(),
            &params,
        );
        approx(scores[&tid(1)], 1.0);
        approx(scores[&tid(2)], 0.5);
        approx(scores[&tid(3)], 0.25);
    }

    #[test]
    fn no_half_life_means_plain_totals() {
        let scores = score_samples(
            vec![
                sample(1, 1.0, "natural_end", 200.0),
                sample(1, 400.0, "natural_end", 200.0),
            ],
            now(),
            &no_decay(),
        );
        approx(scores[&tid(1)], 2.0);
    }

    #[test]
    fn window_drops_old_listens() {
        let params = PopularityParams {
            window_days: Some(7.0),
            ..no_decay()
        };
        let scores = score_samples(
            vec![
                sample(1, 2.0, "natural_end", 200.0),
                sample(1, 20.0, "natural_end", 200.0),
                sample(2, 20.0, "natural_end", 200.0),
            ],
            now(),
            &params,
        );
        approx(scores[&tid(1)], 1.0);
        assert!(!scores.contains_key(&tid(2)));
    }

    #[test]
    fn same_day_repeats_are_damped() {
        let params = PopularityParams {
            half_life_days: None,
            repeat_falloff: 0.5,
            ..PopularityParams::default()
        };
        // Four plays within the same UTC day: 1 + 0.5 + 0.25 + 0.125.
        let scores = score_samples(
            vec![
                sample(1, 0.10, "natural_end", 200.0),
                sample(1, 0.09, "natural_end", 200.0),
                sample(1, 0.08, "natural_end", 200.0),
                sample(1, 0.07, "natural_end", 200.0),
            ],
            now(),
            &params,
        );
        approx(scores[&tid(1)], 1.875);
    }

    #[test]
    fn plays_on_different_days_are_not_damped() {
        let params = PopularityParams {
            half_life_days: None,
            repeat_falloff: 0.5,
            ..PopularityParams::default()
        };
        let scores = score_samples(
            vec![
                sample(1, 1.0, "natural_end", 200.0),
                sample(1, 2.0, "natural_end", 200.0),
            ],
            now(),
            &params,
        );
        approx(scores[&tid(1)], 2.0);
    }

    #[test]
    fn skips_subtract_but_score_never_goes_negative() {
        let scores = score_samples(
            vec![
                sample(1, 1.0, "natural_end", 200.0),
                sample(1, 0.5, "skipped", 3.0),
                sample(2, 0.5, "skipped", 3.0),
                sample(2, 0.4, "skipped", 3.0),
            ],
            now(),
            &no_decay(),
        );
        approx(scores[&tid(1)], 0.75);
        approx(scores[&tid(2)], 0.0);
    }

    fn test_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        crate::db_migrations::run(&conn, None).unwrap();
        conn.execute(
            "INSERT INTO sources (name, root_path, created_at) VALUES ('Music', '/music', 'now')",
            [],
        )
        .unwrap();
        conn
    }

    fn insert_track(conn: &Connection, id: i64, play_count: u32, last_played: Option<&str>) {
        conn.execute(
            "INSERT INTO tracks (id, title, rel_path, date_added, play_count, last_played_at, source_id)
             VALUES (?1, 'T', ?2, '2026-01-01T00:00:00Z', ?3, ?4, 1)",
            params![tid(id), format!("{id}.mp3"), play_count, last_played],
        )
        .unwrap();
    }

    fn insert_event(conn: &Connection, track_id: i64, ended_at: &str, completion: &str) {
        conn.execute(
            "INSERT INTO listen_events
               (id, track_id, started_at, ended_at, listened_seconds, track_duration_seconds,
                completion)
             VALUES (?1, ?2, ?3, ?3, 200.0, 200.0, ?4)",
            params![EventId::new(), tid(track_id), ended_at, completion],
        )
        .unwrap();
    }

    #[test]
    fn track_popularity_reads_events_and_sorts_descending() {
        let conn = test_conn();
        insert_track(&conn, 1, 0, None);
        insert_track(&conn, 2, 0, None);
        insert_event(&conn, 1, "2026-11-10T12:00:00Z", "natural_end");
        insert_event(&conn, 2, "2026-11-01T12:00:00Z", "natural_end");
        insert_event(&conn, 2, "2026-11-02T12:00:00Z", "natural_end");
        insert_event(&conn, 2, "2026-11-03T12:00:00Z", "natural_end");

        let ranked = track_popularity(&conn, &no_decay(), now()).unwrap();
        assert_eq!(
            ranked
                .iter()
                .map(|t| t.track_id.clone())
                .collect::<Vec<_>>(),
            vec![tid(2), tid(1)]
        );

        // A short half-life flips it: the single recent play beats three stale ones.
        let trending = PopularityParams {
            half_life_days: Some(3.0),
            ..no_decay()
        };
        let ranked = track_popularity(&conn, &trending, now()).unwrap();
        assert_eq!(ranked[0].track_id, tid(1));
    }

    #[test]
    fn track_popularity_falls_back_to_legacy_counters() {
        let conn = test_conn();
        insert_track(&conn, 1, 5, Some("2026-11-16T12:00:00Z"));
        // Has events, so its counter is not double counted.
        insert_track(&conn, 2, 9, Some("2026-11-16T12:00:00Z"));
        insert_event(&conn, 2, "2026-11-16T12:00:00Z", "natural_end");
        // Never played.
        insert_track(&conn, 3, 0, None);

        let ranked = track_popularity(&conn, &no_decay(), now()).unwrap();
        assert_eq!(
            ranked,
            vec![
                TrackPopularity {
                    track_id: tid(1),
                    score: 5.0
                },
                TrackPopularity {
                    track_id: tid(2),
                    score: 1.0
                },
            ]
        );
    }

    #[test]
    fn track_popularity_skips_unparsable_timestamps() {
        let conn = test_conn();
        insert_track(&conn, 1, 0, None);
        insert_event(&conn, 1, "not a date", "natural_end");
        assert!(track_popularity(&conn, &no_decay(), now())
            .unwrap()
            .is_empty());
    }
}
