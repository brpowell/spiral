use crate::models::LyricsLine;

const METADATA_TAG_KEYS: &[&str] = &[
    "ar", "ti", "al", "by", "au", "length", "tool", "ve", "re", "la", "creator",
];

#[derive(Debug, Clone, PartialEq)]
pub struct ParsedLrc {
    pub lines: Vec<LyricsLine>,
    pub plain_text: String,
    pub offset_ms: i64,
}

/// True when any non-empty line looks like LRC content.
pub fn is_lrc_content(text: &str) -> bool {
    text.lines()
        .any(|line| !line.trim().is_empty() && looks_like_lrc_timestamp(line.trim()))
}

/// True when a trimmed line starts with an LRC timestamp tag.
pub fn looks_like_lrc_timestamp(line: &str) -> bool {
    let Some(close) = line.find(']') else {
        return false;
    };
    if !line.starts_with('[') || close <= 1 {
        return false;
    }

    let inner = &line[1..close];
    if inner.to_ascii_lowercase().starts_with("offset:") {
        return true;
    }

    let Some((mins, secs_part)) = inner.split_once(':') else {
        return false;
    };
    if mins.is_empty() || !mins.chars().all(|c| c.is_ascii_digit()) {
        return false;
    }

    let secs = secs_part.split('.').next().unwrap_or(secs_part);
    !secs.is_empty() && secs.len() <= 2 && secs.chars().all(|c| c.is_ascii_digit())
}

fn parse_timestamp_ms(inner: &str) -> Option<i64> {
    let (mins_str, rest) = inner.split_once(':')?;
    let mins: i64 = mins_str.parse().ok()?;

    let (secs_str, frac_str) = match rest.find('.') {
        Some(dot) => (&rest[..dot], Some(&rest[dot + 1..])),
        None => (rest, None),
    };
    let secs: i64 = secs_str.parse().ok()?;

    let frac_ms = match frac_str {
        None => 0,
        Some(f) if f.is_empty() => 0,
        Some(f) if f.len() == 1 => f.parse::<i64>().ok()? * 100,
        Some(f) if f.len() == 2 => f.parse::<i64>().ok()? * 10,
        Some(f) => f[..f.len().min(3)].parse::<i64>().ok()?,
    };

    Some(mins * 60_000 + secs * 1_000 + frac_ms)
}

fn parse_offset_ms(inner: &str) -> Option<i64> {
    let lower = inner.to_ascii_lowercase();
    if !lower.starts_with("offset:") {
        return None;
    }
    inner["offset:".len()..].trim().parse().ok()
}

fn is_metadata_tag(inner: &str) -> bool {
    let Some((key, _)) = inner.split_once(':') else {
        return false;
    };
    METADATA_TAG_KEYS.contains(&key.to_ascii_lowercase().as_str())
}

/// Parse LRC text into timed lyric lines.
pub fn parse_lrc(text: &str) -> ParsedLrc {
    let mut offset_ms: i64 = 0;
    let mut lines = Vec::new();

    for raw_line in text.lines() {
        let mut remaining = raw_line.trim();
        if remaining.is_empty() {
            lines.push(LyricsLine {
                text: String::new(),
                start_ms: None,
                end_ms: None,
                words: None,
            });
            continue;
        }

        let mut timestamps = Vec::new();
        let mut metadata_only = false;

        while remaining.starts_with('[') {
            let Some(close) = remaining.find(']') else {
                break;
            };
            let inner = &remaining[1..close];
            remaining = remaining[close + 1..].trim_start();

            if let Some(offset) = parse_offset_ms(inner) {
                offset_ms = offset;
                metadata_only = remaining.is_empty();
                continue;
            }

            if is_metadata_tag(inner) {
                metadata_only = remaining.is_empty();
                continue;
            }

            if let Some(timestamp) = parse_timestamp_ms(inner) {
                timestamps.push(timestamp + offset_ms);
            }
        }

        if metadata_only {
            continue;
        }

        if timestamps.is_empty() {
            if !remaining.is_empty() {
                lines.push(LyricsLine {
                    text: remaining.to_string(),
                    start_ms: None,
                    end_ms: None,
                    words: None,
                });
            }
            continue;
        }

        for start_ms in timestamps {
            lines.push(LyricsLine {
                text: remaining.to_string(),
                start_ms: Some(start_ms),
                end_ms: None,
                words: None,
            });
        }
    }

    let plain_text = lines
        .iter()
        .map(|line| line.text.as_str())
        .collect::<Vec<_>>()
        .join("\n");
    ParsedLrc {
        lines,
        plain_text,
        offset_ms,
    }
}

fn format_timestamp(ms: i64) -> String {
    let clamped = ms.max(0);
    let mins = clamped / 60_000;
    let secs = (clamped % 60_000) / 1_000;
    let centis = (clamped % 1_000) / 10;
    format!("[{mins:02}:{secs:02}.{centis:02}]")
}

/// Serialize timed lines back to LRC.
pub fn serialize_lrc(lines: &[LyricsLine], offset_ms: i64) -> String {
    let mut output = Vec::new();
    if offset_ms != 0 {
        output.push(format!("[offset:{offset_ms}]"));
    }

    for line in lines {
        if let Some(start_ms) = line.start_ms {
            let tag = format_timestamp(start_ms - offset_ms);
            let suffix = if line.text.is_empty() {
                String::new()
            } else if line.text.starts_with(' ') {
                line.text.clone()
            } else {
                format!(" {}", line.text)
            };
            output.push(format!("{tag}{suffix}"));
        } else if !line.text.is_empty() {
            output.push(line.text.clone());
        } else {
            output.push(String::new());
        }
    }

    output.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_lrc_reads_fractional_and_integer_timestamps() {
        let parsed = parse_lrc(
            "[00:12.50] Half past twelve\n[01:02] One minute two\n[00:12.500] Milliseconds",
        );

        assert_eq!(parsed.lines[0].start_ms, Some(12_500));
        assert_eq!(parsed.lines[0].text, "Half past twelve");
        assert_eq!(parsed.lines[1].start_ms, Some(62_000));
        assert_eq!(parsed.lines[2].start_ms, Some(12_500));
    }

    #[test]
    fn parse_lrc_applies_offset_tag() {
        let parsed = parse_lrc("[offset:+500]\n[00:01.00] Delayed");

        assert_eq!(parsed.offset_ms, 500);
        assert_eq!(parsed.lines[0].start_ms, Some(1_500));
        assert_eq!(parsed.lines[0].text, "Delayed");
    }

    #[test]
    fn parse_lrc_skips_metadata_tags_and_blank_lines() {
        let parsed = parse_lrc(
            "[ar:Artist Name]\n[ti:Title]\n\n[00:10.00] First line\n\n[00:20.00] Second line",
        );

        assert_eq!(parsed.lines.len(), 4);
        assert_eq!(parsed.lines[0].text, "");
        assert_eq!(parsed.lines[1].start_ms, Some(10_000));
        assert_eq!(parsed.lines[1].text, "First line");
        assert_eq!(parsed.lines[2].text, "");
        assert_eq!(parsed.lines[3].start_ms, Some(20_000));
        assert_eq!(parsed.plain_text, "\nFirst line\n\nSecond line");
    }

    #[test]
    fn parse_lrc_handles_multiple_timestamps_on_one_line() {
        let parsed = parse_lrc("[00:10.00][00:50.00] Chorus");

        assert_eq!(parsed.lines.len(), 2);
        assert_eq!(parsed.lines[0].start_ms, Some(10_000));
        assert_eq!(parsed.lines[1].start_ms, Some(50_000));
        assert_eq!(parsed.plain_text, "Chorus\nChorus");
    }

    #[test]
    fn serialize_lrc_emits_one_row_per_timed_line() {
        let lines = vec![
            LyricsLine {
                text: "Chorus".to_string(),
                start_ms: Some(10_000),
                end_ms: None,
                words: None,
            },
            LyricsLine {
                text: "Chorus".to_string(),
                start_ms: Some(50_000),
                end_ms: None,
                words: None,
            },
        ];

        let serialized = serialize_lrc(&lines, 0);
        assert_eq!(serialized, "[00:10.00] Chorus\n[00:50.00] Chorus");
    }

    #[test]
    fn serialize_lrc_round_trips_timed_lines() {
        let source = "[offset:250]\n[00:12.50] Hello\n[00:20.00] World";
        let parsed = parse_lrc(source);
        let serialized = serialize_lrc(&parsed.lines, parsed.offset_ms);
        let reparsed = parse_lrc(&serialized);

        assert_eq!(reparsed.offset_ms, parsed.offset_ms);
        assert_eq!(reparsed.plain_text, parsed.plain_text);
        assert_eq!(reparsed.lines.len(), parsed.lines.len());
        for (left, right) in reparsed.lines.iter().zip(parsed.lines.iter()) {
            assert_eq!(left.start_ms, right.start_ms);
            assert_eq!(left.text, right.text);
        }
    }
}
