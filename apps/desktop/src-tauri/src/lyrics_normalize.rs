use crate::db;
use crate::lyrics_lrc;
use crate::lyrics_tags::RawLyrics;
use crate::models::{LyricsFormat, LyricsSource, TrackLyricsInput, TrackLyricsRecord};
use chrono::Utc;
use rusqlite::Connection;

fn normalize_lyrics_with_source(raw: RawLyrics, source: LyricsSource) -> TrackLyricsInput {
    if raw.hint == crate::lyrics_tags::LyricsFormatHint::LineSynced {
        let parsed = lyrics_lrc::parse_lrc(&raw.text);
        TrackLyricsInput {
            format: LyricsFormat::LineSynced,
            source: Some(source),
            lines: parsed.lines,
            plain_text: parsed.plain_text,
        }
    } else {
        let mut plain = crate::lyrics_tags::track_lyrics_input_from_plain(&raw.text);
        plain.source = Some(source);
        plain
    }
}

pub fn normalize_embedded_lyrics(raw: RawLyrics) -> TrackLyricsInput {
    normalize_lyrics_with_source(raw, LyricsSource::Embedded)
}

pub fn normalize_sidecar_lyrics(raw: RawLyrics) -> TrackLyricsInput {
    normalize_lyrics_with_source(raw, LyricsSource::Sidecar)
}

fn lyrics_format_rank(format: &LyricsFormat) -> u8 {
    match format {
        LyricsFormat::Instrumental => 0,
        LyricsFormat::Plain => 1,
        LyricsFormat::LineSynced => 2,
        LyricsFormat::WordSynced => 3,
    }
}

/// Choose between embedded tags and sibling `.lrc` lyrics.
/// Prefer richer format; on a format tie prefer tags when content differs,
/// or sidecar when content matches and sidecar is line-synced.
pub fn resolve_embedded_and_sidecar_lyrics(
    embedded: Option<TrackLyricsInput>,
    sidecar: Option<TrackLyricsInput>,
) -> Option<TrackLyricsInput> {
    match (embedded, sidecar) {
        (None, None) => None,
        (Some(embedded), None) => Some(embedded),
        (None, Some(sidecar)) => Some(sidecar),
        (Some(embedded), Some(sidecar)) => {
            let embedded_rank = lyrics_format_rank(&embedded.format);
            let sidecar_rank = lyrics_format_rank(&sidecar.format);
            if sidecar_rank > embedded_rank {
                Some(sidecar)
            } else if embedded_rank > sidecar_rank {
                Some(embedded)
            } else if embedded.plain_text.trim() == sidecar.plain_text.trim()
                && sidecar.format == LyricsFormat::LineSynced
            {
                Some(sidecar)
            } else {
                Some(embedded)
            }
        }
    }
}

pub fn track_lyrics_input_to_record(input: TrackLyricsInput, track_id: i64) -> TrackLyricsRecord {
    TrackLyricsRecord {
        track_id,
        format: input.format,
        source: input.source,
        lines: input.lines,
        plain_text: input.plain_text,
        updated_at: Utc::now().to_rfc3339(),
    }
}

pub fn track_lyrics_record_to_input(record: TrackLyricsRecord) -> TrackLyricsInput {
    TrackLyricsInput {
        format: record.format,
        source: record.source,
        lines: record.lines,
        plain_text: record.plain_text,
    }
}

/// Persists embedded lyrics from import when present. Does not delete existing
/// lyrics when `lyrics` is absent — refresh and re-import without tags must not
/// wipe library lyrics until conflict UI exists (Phase 2).
pub fn persist_import_lyrics(
    conn: &Connection,
    track_id: i64,
    lyrics: &Option<TrackLyricsInput>,
) -> rusqlite::Result<()> {
    let Some(lyrics) = lyrics else {
        return Ok(());
    };
    if lyrics.plain_text.trim().is_empty() {
        return Ok(());
    }
    let record = track_lyrics_input_to_record(lyrics.clone(), track_id);
    db::upsert_track_lyrics(conn, &record)
}

/// Store edited or fetched lyrics as the track's canonical lyrics. Empty
/// lyrics (other than an instrumental marker) clear them.
pub fn save_track_lyrics(
    conn: &Connection,
    track_id: i64,
    lyrics: Option<&TrackLyricsInput>,
) -> rusqlite::Result<()> {
    match lyrics.filter(|lyrics| {
        lyrics.format == crate::models::LyricsFormat::Instrumental
            || !lyrics.plain_text.trim().is_empty()
    }) {
        Some(lyrics) => {
            let record = track_lyrics_input_to_record(lyrics.clone(), track_id);
            db::upsert_track_lyrics(conn, &record)
        }
        None => db::delete_track_lyrics(conn, track_id),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lyrics_tags::{LyricsFormatHint, RawLyrics};
    use crate::models::LyricsFormat;

    #[test]
    fn normalize_embedded_lyrics_splits_plain_text_into_lines() {
        let input = normalize_embedded_lyrics(RawLyrics {
            text: "First line\nSecond line".to_string(),
            hint: LyricsFormatHint::Plain,
        });

        assert_eq!(input.format, LyricsFormat::Plain);
        assert_eq!(input.source, Some(LyricsSource::Embedded));
        assert_eq!(input.plain_text, "First line\nSecond line");
        assert_eq!(input.lines.len(), 2);
        assert_eq!(input.lines[0].text, "First line");
        assert_eq!(input.lines[1].text, "Second line");
    }

    #[test]
    fn normalize_embedded_lyrics_parses_lrc_into_line_synced() {
        let input = normalize_embedded_lyrics(RawLyrics {
            text: "[00:12.50] Synced line".to_string(),
            hint: LyricsFormatHint::LineSynced,
        });

        assert_eq!(input.format, LyricsFormat::LineSynced);
        assert_eq!(input.plain_text, "Synced line");
        assert_eq!(input.lines.len(), 1);
        assert_eq!(input.lines[0].text, "Synced line");
        assert_eq!(input.lines[0].start_ms, Some(12_500));
    }

    #[test]
    fn normalize_sidecar_lyrics_sets_sidecar_source() {
        let input = normalize_sidecar_lyrics(RawLyrics {
            text: "[00:12.50] Synced line".to_string(),
            hint: LyricsFormatHint::LineSynced,
        });

        assert_eq!(input.format, LyricsFormat::LineSynced);
        assert_eq!(input.source, Some(LyricsSource::Sidecar));
        assert_eq!(input.plain_text, "Synced line");
    }

    #[test]
    fn resolve_prefers_line_synced_sidecar_over_plain_embedded() {
        let embedded = normalize_embedded_lyrics(RawLyrics {
            text: "Hello".to_string(),
            hint: LyricsFormatHint::Plain,
        });
        let sidecar = normalize_sidecar_lyrics(RawLyrics {
            text: "[00:01.00] Hello".to_string(),
            hint: LyricsFormatHint::LineSynced,
        });
        let resolved = resolve_embedded_and_sidecar_lyrics(Some(embedded), Some(sidecar)).unwrap();
        assert_eq!(resolved.source, Some(LyricsSource::Sidecar));
        assert_eq!(resolved.format, LyricsFormat::LineSynced);
    }

    #[test]
    fn resolve_keeps_embedded_when_same_format_content_differs() {
        let embedded = normalize_embedded_lyrics(RawLyrics {
            text: "[00:01.00] Tags".to_string(),
            hint: LyricsFormatHint::LineSynced,
        });
        let sidecar = normalize_sidecar_lyrics(RawLyrics {
            text: "[00:02.00] Sidecar".to_string(),
            hint: LyricsFormatHint::LineSynced,
        });
        let resolved = resolve_embedded_and_sidecar_lyrics(Some(embedded), Some(sidecar)).unwrap();
        assert_eq!(resolved.source, Some(LyricsSource::Embedded));
        assert_eq!(resolved.plain_text, "Tags");
    }

    #[test]
    fn track_lyrics_input_to_record_assigns_track_id() {
        let input = normalize_embedded_lyrics(RawLyrics {
            text: "Hello".to_string(),
            hint: LyricsFormatHint::Plain,
        });
        let record = track_lyrics_input_to_record(input, 42);

        assert_eq!(record.track_id, 42);
        assert_eq!(record.plain_text, "Hello");
        assert!(!record.updated_at.is_empty());
    }
}
