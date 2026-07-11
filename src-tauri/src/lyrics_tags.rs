use crate::lyrics_lrc;
use crate::models::{LyricsFormat, TrackLyricsInput, TrackMetadataUpdate};
use id3::frame::Lyrics as Id3Lyrics;
use id3::Tag;
use id3::TagLike;
use lofty::tag::{ItemKey, ItemValue, Tag as LoftyTag, TagItem};
use metaflac::Tag as FlacTag;
use mp4ameta::Tag as Mp4Tag;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LyricsFormatHint {
    Plain,
    LineSynced,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RawLyrics {
    pub text: String,
    pub hint: LyricsFormatHint,
}

pub fn detect_lyrics_format_hint(text: &str) -> LyricsFormatHint {
    if lyrics_lrc::is_lrc_content(text) {
        LyricsFormatHint::LineSynced
    } else {
        LyricsFormatHint::Plain
    }
}

pub fn read_lyrics_from_id3(tag: &Tag) -> Option<RawLyrics> {
    let frames: Vec<_> = tag
        .frames()
        .filter_map(|frame| frame.content().lyrics().cloned())
        .collect();

    if frames.is_empty() {
        return None;
    }

    let selected = frames
        .iter()
        .find(|lyrics| lyrics.lang.eq_ignore_ascii_case("eng"))
        .unwrap_or(&frames[0]);

    raw_from_text(&selected.text)
}

pub fn read_lyrics_from_flac(tag: &FlacTag) -> Option<RawLyrics> {
    read_vorbis_comment_lyrics(tag, "LYRICS")
        .or_else(|| read_vorbis_comment_lyrics(tag, "UNSYNCEDLYRICS"))
}

fn read_vorbis_comment_lyrics(tag: &FlacTag, key: &str) -> Option<RawLyrics> {
    let values = tag.get_vorbis(key)?;
    let text = values
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    raw_from_text(&text)
}

pub fn read_lyrics_from_mp4(tag: &Mp4Tag) -> Option<RawLyrics> {
    tag.lyrics().and_then(raw_from_text)
}

pub fn read_lyrics_from_vorbis(tag: &LoftyTag) -> Option<RawLyrics> {
    tag.get_string(&ItemKey::Lyrics)
        .map(str::to_string)
        .or_else(|| read_lofty_unknown_lyrics(tag, "LYRICS"))
        .or_else(|| read_lofty_unknown_lyrics(tag, "UNSYNCEDLYRICS"))
        .and_then(|text| raw_from_text(&text))
}

fn read_lofty_unknown_lyrics(tag: &LoftyTag, key: &str) -> Option<String> {
    tag.get(&ItemKey::Unknown(key.to_string()))
        .and_then(|item| item.value().text().map(str::to_string))
}

fn raw_from_text(text: &str) -> Option<RawLyrics> {
    let text = text.trim().to_string();
    if text.is_empty() {
        return None;
    }

    Some(RawLyrics {
        hint: detect_lyrics_format_hint(&text),
        text,
    })
}

pub enum LyricsEmbedKind {
    /// ID3, FLAC, OGG — embed full LRC when line-synced.
    SyncCapable,
    /// MP4/M4A — plain `©lyr` only; timestamps do not round-trip.
    Mp4,
}

pub fn lyrics_text_for_embed_input(
    lyrics: Option<&TrackLyricsInput>,
    kind: LyricsEmbedKind,
) -> (String, bool) {
    match lyrics {
        None => (String::new(), true),
        Some(lyrics) if lyrics.plain_text.trim().is_empty() => (String::new(), true),
        Some(lyrics) => {
            let text = match kind {
                LyricsEmbedKind::Mp4 => lyrics.plain_text.clone(),
                LyricsEmbedKind::SyncCapable => match lyrics.format {
                    LyricsFormat::LineSynced => lyrics_lrc::serialize_lrc(&lyrics.lines, 0),
                    LyricsFormat::Plain
                    | LyricsFormat::WordSynced
                    | LyricsFormat::Instrumental => lyrics.plain_text.clone(),
                },
            };
            (text, false)
        }
    }
}

pub fn lyrics_text_for_embed(
    metadata: &TrackMetadataUpdate,
    kind: LyricsEmbedKind,
) -> (String, bool) {
    lyrics_text_for_embed_input(metadata.lyrics.as_ref(), kind)
}

pub fn apply_lyrics_to_id3(tag: &mut Tag, plain: &str, remove: bool) {
    while !tag.remove("USLT").is_empty() {}

    if !remove && !plain.trim().is_empty() {
        tag.add_frame(Id3Lyrics {
            lang: "eng".to_string(),
            description: String::new(),
            text: plain.to_string(),
        });
    }
}

pub fn apply_lyrics_to_flac(tag: &mut FlacTag, plain: &str, remove: bool) {
    tag.remove_vorbis("LYRICS");
    tag.remove_vorbis("UNSYNCEDLYRICS");

    if !remove && !plain.trim().is_empty() {
        tag.set_vorbis("LYRICS", vec![plain]);
    }
}

pub fn apply_lyrics_to_mp4(tag: &mut Mp4Tag, plain: &str, remove: bool) {
    tag.remove_lyrics();

    if !remove && !plain.trim().is_empty() {
        tag.set_lyrics(plain);
    }
}

pub fn apply_lyrics_to_vorbis(tag: &mut LoftyTag, plain: &str, remove: bool) {
    tag.remove_key(&ItemKey::Lyrics);
    tag.remove_key(&ItemKey::Unknown("LYRICS".to_string()));
    tag.remove_key(&ItemKey::Unknown("UNSYNCEDLYRICS".to_string()));

    if !remove && !plain.trim().is_empty() {
        tag.insert(TagItem::new(
            ItemKey::Lyrics,
            ItemValue::Text(plain.to_string()),
        ));
    }
}

pub fn track_lyrics_input_from_plain(plain_text: &str) -> TrackLyricsInput {
    let plain_text = plain_text.to_string();
    let lines = plain_text
        .lines()
        .map(|line| crate::models::LyricsLine {
            text: line.to_string(),
            start_ms: None,
            end_ms: None,
            words: None,
        })
        .collect();

    TrackLyricsInput {
        format: crate::models::LyricsFormat::Plain,
        source: Some(crate::models::LyricsSource::Manual),
        lines,
        plain_text,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use id3::frame::Lyrics as Id3Lyrics;
    use id3::{Tag, TagLike, Version};
    use lofty::config::WriteOptions;
    use lofty::file::{AudioFile, TaggedFileExt};
    use lofty::probe::Probe;
    use lofty::tag::{ItemValue, Tag as LoftyTag, TagItem, TagType};
    use metaflac::Tag as FlacTag;
    use mp4ameta::Tag as Mp4Tag;
    use std::fs;
    use std::io::Write;
    use std::path::{Path, PathBuf};

    #[test]
    fn lyrics_text_for_embed_uses_lrc_for_line_synced() {
        use crate::models::{LyricsFormat, LyricsLine, LyricsSource, TrackLyricsInput};

        let metadata = TrackMetadataUpdate {
            title: "Title".to_string(),
            artist: None,
            album: None,
            album_artist: None,
            track_number: None,
            disc_number: None,
            year: None,
            genre: None,
            art_path: None,
            art_changed: false,
            lyrics: Some(TrackLyricsInput {
                format: LyricsFormat::LineSynced,
                source: Some(LyricsSource::Manual),
                lines: vec![LyricsLine {
                    text: "Synced".to_string(),
                    start_ms: Some(3_000),
                    end_ms: None,
                    words: None,
                }],
                plain_text: "Synced".to_string(),
            }),
            lyrics_changed: true,
        };

        let (sync_text, remove) =
            lyrics_text_for_embed(&metadata, LyricsEmbedKind::SyncCapable);
        assert!(!remove);
        assert!(sync_text.contains("[00:03.00] Synced"));

        let (mp4_text, remove) = lyrics_text_for_embed(&metadata, LyricsEmbedKind::Mp4);
        assert!(!remove);
        assert_eq!(mp4_text, "Synced");
    }

    #[test]
    fn detect_lyrics_format_hint_recognizes_lrc_prefix() {
        assert_eq!(
            detect_lyrics_format_hint("[00:12.50] Hello\nNext line"),
            LyricsFormatHint::LineSynced
        );
        assert_eq!(
            detect_lyrics_format_hint("Plain line one\nLine two"),
            LyricsFormatHint::Plain
        );
    }

    #[test]
    fn read_lyrics_from_id3_prefers_eng_language() {
        let mut tag = Tag::new();
        tag.add_frame(Id3Lyrics {
            lang: "deu".to_string(),
            description: String::new(),
            text: "German lyrics".to_string(),
        });
        tag.add_frame(Id3Lyrics {
            lang: "eng".to_string(),
            description: String::new(),
            text: "English lyrics".to_string(),
        });

        let raw = read_lyrics_from_id3(&tag).unwrap();
        assert_eq!(raw.text, "English lyrics");
    }

    fn write_minimal_mp3(path: &Path) {
        let mut file = fs::File::create(path).unwrap();
        file.write_all(&[0xFF, 0xFB, 0x90, 0x00, 0x00, 0x00, 0x00, 0x00])
            .unwrap();
    }

    fn write_mp3_with_lyrics(path: &Path, lyrics: &str) {
        write_minimal_mp3(path);
        let mut tag = Tag::read_from_path(path).unwrap_or_else(|_| Tag::new());
        tag.set_title("Lyrics Test");
        tag.add_frame(Id3Lyrics {
            lang: "eng".to_string(),
            description: String::new(),
            text: lyrics.to_string(),
        });
        tag.write_to_path(path, Version::Id3v24).unwrap();
    }

    fn copy_minimal_flac(dest: &Path) {
        let src = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/minimal.flac");
        fs::copy(src, dest).expect("copy flac fixture");
    }

    fn write_flac_with_lyrics(path: &Path, lyrics: &str) {
        copy_minimal_flac(path);
        let mut tag = FlacTag::read_from_path(path).expect("read flac");
        tag.set_vorbis("LYRICS", vec![lyrics]);
        tag.save().expect("save flac lyrics");
    }

    fn write_m4a_with_lyrics(path: &Path, lyrics: &str) {
        let src = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/moov_before_mdat.m4a");
        fs::copy(src, path).expect("copy m4a fixture");
        let mut tag = Mp4Tag::read_from_path(path).expect("read m4a");
        tag.set_lyrics(lyrics);
        tag.write_to_path(path).expect("write m4a lyrics");
    }

    fn write_ogg_with_lyrics(path: &Path, lyrics: &str) {
        let src = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/minimal.ogg");
        fs::copy(src, path).expect("copy ogg fixture");
        let mut tagged = Probe::open(path)
            .expect("open ogg")
            .guess_file_type()
            .expect("guess ogg")
            .read()
            .expect("read ogg");
        if tagged.primary_tag().is_none() {
            tagged.insert_tag(LoftyTag::new(TagType::VorbisComments));
        }
        let tag = tagged.primary_tag_mut().expect("vorbis tag");
        tag.insert(TagItem::new(
            ItemKey::Lyrics,
            ItemValue::Text(lyrics.to_string()),
        ));
        tagged
            .save_to_path(path, WriteOptions::default())
            .expect("write ogg lyrics");
    }

    #[test]
    fn read_lyrics_from_mp3_fixture() {
        let dir = std::env::temp_dir().join(format!("spiral-lyrics-mp3-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let audio = dir.join("lyrics.mp3");
        write_mp3_with_lyrics(&audio, "Line one\nLine two");

        let tag = Tag::read_from_path(&audio).expect("read mp3 tag");
        let raw = read_lyrics_from_id3(&tag).unwrap();
        assert_eq!(raw.text, "Line one\nLine two");
        assert_eq!(raw.hint, LyricsFormatHint::Plain);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_lyrics_from_flac_fixture() {
        let dir = std::env::temp_dir().join(format!("spiral-lyrics-flac-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let audio = dir.join("lyrics.flac");
        write_flac_with_lyrics(&audio, "FLAC lyrics body");

        let tag = FlacTag::read_from_path(&audio).expect("read flac");
        let raw = read_lyrics_from_flac(&tag).unwrap();
        assert_eq!(raw.text, "FLAC lyrics body");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_lyrics_from_m4a_fixture() {
        let dir = std::env::temp_dir().join(format!("spiral-lyrics-m4a-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let audio = dir.join("lyrics.m4a");
        write_m4a_with_lyrics(&audio, "M4A lyrics body");

        let tag = Mp4Tag::read_from_path(&audio).expect("read m4a");
        let raw = read_lyrics_from_mp4(&tag).unwrap();
        assert_eq!(raw.text, "M4A lyrics body");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_lyrics_from_ogg_fixture() {
        let dir = std::env::temp_dir().join(format!("spiral-lyrics-ogg-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let audio = dir.join("lyrics.ogg");
        write_ogg_with_lyrics(&audio, "OGG lyrics body");

        let tagged = Probe::open(&audio)
            .expect("open ogg")
            .guess_file_type()
            .expect("guess ogg")
            .read()
            .expect("read ogg");
        let tag = tagged.primary_tag().expect("vorbis tag");
        let raw = read_lyrics_from_vorbis(tag).unwrap();
        assert_eq!(raw.text, "OGG lyrics body");

        let _ = fs::remove_dir_all(&dir);
    }
}
