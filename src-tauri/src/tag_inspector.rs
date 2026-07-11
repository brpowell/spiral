//! Read embedded audio tags using the same code paths as Spiral (for manual QA).

use crate::audio_formats;
use crate::lyrics_tags::{LyricsFormatHint, RawLyrics};
use crate::metadata_reader;
use id3::Tag;
use lofty::file::TaggedFileExt;
use lofty::probe::Probe;
use lofty::tag::{ItemKey, Tag as LoftyTag};
use metaflac::Tag as FlacTag;
use mp4ameta::Tag as Mp4Tag;
use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize)]
pub struct RawLyricsTag {
    pub key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lang: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub line_count: usize,
    pub byte_len: usize,
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct LyricsReport {
    pub format_hint: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct BasicTagReport {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub track_number: Option<i32>,
    pub disc_number: Option<i32>,
    pub year: Option<i32>,
    pub genre: Option<String>,
    pub rating: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_seconds: Option<f64>,
    pub has_embedded_art: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct TagFileReport {
    pub path: String,
    pub extension: String,
    pub supported: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub tags: BasicTagReport,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lyrics: Option<LyricsReport>,
    pub raw_lyrics_tags: Vec<RawLyricsTag>,
}

fn audio_extension(path: &Path) -> Option<String> {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
}

fn lyrics_hint_label(hint: &LyricsFormatHint) -> &'static str {
    match hint {
        LyricsFormatHint::Plain => "plain",
        LyricsFormatHint::LineSynced => "line_synced",
    }
}

fn lyrics_report(raw: &RawLyrics) -> LyricsReport {
    LyricsReport {
        format_hint: lyrics_hint_label(&raw.hint).to_string(),
        text: raw.text.clone(),
    }
}

fn raw_lyrics_tag(key: impl Into<String>, text: &str) -> RawLyricsTag {
    RawLyricsTag {
        key: key.into(),
        lang: None,
        description: None,
        line_count: text.lines().count(),
        byte_len: text.len(),
        text: text.to_string(),
    }
}

fn raw_id3_lyrics_tags(path: &Path) -> Vec<RawLyricsTag> {
    let Ok(tag) = Tag::read_from_path(path) else {
        return Vec::new();
    };

    tag.frames()
        .filter_map(|frame| frame.content().lyrics())
        .map(|lyrics| RawLyricsTag {
            key: "USLT".to_string(),
            lang: Some(lyrics.lang.clone()),
            description: if lyrics.description.is_empty() {
                None
            } else {
                Some(lyrics.description.clone())
            },
            line_count: lyrics.text.lines().count(),
            byte_len: lyrics.text.len(),
            text: lyrics.text.clone(),
        })
        .collect()
}

fn raw_flac_lyrics_tags(path: &Path) -> Vec<RawLyricsTag> {
    let Ok(tag) = FlacTag::read_from_path(path) else {
        return Vec::new();
    };

    ["LYRICS", "UNSYNCEDLYRICS"]
        .into_iter()
        .filter_map(|key| {
            let values: Vec<String> = tag
                .get_vorbis(key)?
                .map(str::to_string)
                .collect();
            if values.is_empty() {
                return None;
            }
            let text = values.join("\n");
            Some(raw_lyrics_tag(key, &text))
        })
        .collect()
}

fn raw_mp4_lyrics_tags(path: &Path) -> Vec<RawLyricsTag> {
    let Ok(tag) = Mp4Tag::read_from_path(path) else {
        return Vec::new();
    };

    tag.lyrics()
        .map(|text| vec![raw_lyrics_tag("©lyr", text)])
        .unwrap_or_default()
}

fn raw_vorbis_lyrics_tags(path: &Path) -> Vec<RawLyricsTag> {
    let tagged = match Probe::open(path) {
        Ok(probe) => match probe.guess_file_type() {
            Ok(probe) => match probe.read() {
                Ok(tagged) => tagged,
                Err(_) => return Vec::new(),
            },
            Err(_) => return Vec::new(),
        },
        Err(_) => return Vec::new(),
    };

    let Some(tag) = tagged.primary_tag().or_else(|| tagged.first_tag()) else {
        return Vec::new();
    };

    raw_lofty_lyrics_tags(tag)
}

fn raw_lofty_lyrics_tags(tag: &LoftyTag) -> Vec<RawLyricsTag> {
    let mut raw = Vec::new();

    if let Some(text) = tag.get_string(&ItemKey::Lyrics) {
        raw.push(raw_lyrics_tag("LYRICS (ItemKey::Lyrics)", text));
    }

    for key in ["LYRICS", "UNSYNCEDLYRICS"] {
        if let Some(item) = tag.get(&ItemKey::Unknown(key.to_string())) {
            if let Some(text) = item.value().text() {
                if !text.is_empty() {
                    raw.push(raw_lyrics_tag(key, text));
                }
            }
        }
    }

    raw
}

fn raw_lyrics_tags_for_path(path: &Path, ext: &str) -> Vec<RawLyricsTag> {
    match ext {
        "mp3" | "wav" => raw_id3_lyrics_tags(path),
        "flac" => raw_flac_lyrics_tags(path),
        "m4a" | "aac" | "mp4" => raw_mp4_lyrics_tags(path),
        "ogg" | "opus" => raw_vorbis_lyrics_tags(path),
        _ => Vec::new(),
    }
}

pub fn inspect_path(path: &Path) -> TagFileReport {
    let extension = audio_extension(path).unwrap_or_default();
    let supported = audio_formats::is_supported_audio_file(path);

    if !path.is_file() {
        return TagFileReport {
            path: path.display().to_string(),
            extension,
            supported,
            error: Some("not a file".to_string()),
            tags: BasicTagReport {
                title: None,
                artist: None,
                album: None,
                album_artist: None,
                track_number: None,
                disc_number: None,
                year: None,
                genre: None,
                rating: None,
                duration_seconds: None,
                has_embedded_art: false,
            },
            lyrics: None,
            raw_lyrics_tags: Vec::new(),
        };
    }

    if !supported {
        return TagFileReport {
            path: path.display().to_string(),
            extension,
            supported,
            error: Some("unsupported audio extension".to_string()),
            tags: BasicTagReport {
                title: None,
                artist: None,
                album: None,
                album_artist: None,
                track_number: None,
                disc_number: None,
                year: None,
                genre: None,
                rating: None,
                duration_seconds: None,
                has_embedded_art: false,
            },
            lyrics: None,
            raw_lyrics_tags: Vec::new(),
        };
    }

    let tags = metadata_reader::read_basic_tags(path);
    let raw_lyrics_tags = raw_lyrics_tags_for_path(path, &extension);

    TagFileReport {
        path: path.display().to_string(),
        extension,
        supported,
        error: None,
        tags: BasicTagReport {
            title: tags.title,
            artist: tags.artist,
            album: tags.album,
            album_artist: tags.album_artist,
            track_number: tags.track_number,
            disc_number: tags.disc_number,
            year: tags.year,
            genre: tags.genre,
            rating: tags.rating,
            duration_seconds: tags.duration_seconds,
            has_embedded_art: false,
        },
        lyrics: tags.lyrics.as_ref().map(lyrics_report),
        raw_lyrics_tags,
    }
}

pub fn collect_supported_audio_files(paths: &[PathBuf], recursive: bool) -> Vec<PathBuf> {
    let mut files = Vec::new();

    for path in paths {
        if path.is_file() {
            files.push(path.clone());
            continue;
        }

        if !path.is_dir() || !recursive {
            continue;
        }

        let walker = walkdir::WalkDir::new(path)
            .follow_links(false)
            .into_iter()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_type().is_file());

        for entry in walker {
            let file_path = entry.into_path();
            if audio_formats::is_supported_audio_file(&file_path) {
                files.push(file_path);
            }
        }
    }

    files.sort();
    files.dedup();
    files
}

pub fn print_human_report(report: &TagFileReport) {
    println!("=== {} ({}) ===", report.path, report.extension);

    if let Some(error) = &report.error {
        println!("error: {error}");
        println!();
        return;
    }

    let tags = &report.tags;
    print_field("title", tags.title.as_deref());
    print_field("artist", tags.artist.as_deref());
    print_field("album", tags.album.as_deref());
    print_field("album artist", tags.album_artist.as_deref());
    print_number("track", tags.track_number);
    print_number("disc", tags.disc_number);
    print_number("year", tags.year);
    print_field("genre", tags.genre.as_deref());
    if let Some(rating) = tags.rating {
        println!("rating:      {rating}");
    }
    if let Some(duration) = tags.duration_seconds {
        println!("duration:    {duration:.1}s");
    }

    println!();
    println!("lyrics (Spiral read path):");
    match &report.lyrics {
        Some(lyrics) => {
            println!("  format hint: {}", lyrics.format_hint);
            if lyrics.text.is_empty() {
                println!("  (empty)");
            } else {
                println!("  text:");
                for line in lyrics.text.lines() {
                    println!("    {line}");
                }
            }
        }
        None => println!("  (none)"),
    }

    println!();
    println!("raw lyrics tags:");
    if report.raw_lyrics_tags.is_empty() {
        println!("  (none)");
    } else {
        for raw in &report.raw_lyrics_tags {
            let mut header = format!("  {} ({} lines, {} bytes)", raw.key, raw.line_count, raw.byte_len);
            if let Some(lang) = &raw.lang {
                header.push_str(&format!(", lang={lang}"));
            }
            if let Some(description) = &raw.description {
                header.push_str(&format!(", descr=\"{description}\""));
            }
            println!("{header}");
            if raw.text.is_empty() {
                println!("    (empty)");
            } else {
                for line in raw.text.lines() {
                    println!("    {line}");
                }
            }
        }
    }

    println!();
}

fn print_field(label: &str, value: Option<&str>) {
    if let Some(value) = value {
        println!("{label:<13}{value}");
    }
}

fn print_number(label: &str, value: Option<i32>) {
    if let Some(value) = value {
        println!("{label:<13}{value}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn inspect_fixture_flac_is_supported() {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/minimal.flac");
        let report = inspect_path(&path);
        assert!(report.supported);
        assert!(report.error.is_none());
    }
}
