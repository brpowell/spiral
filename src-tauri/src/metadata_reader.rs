use crate::art_cache;
use crate::artist_tags::join_artist_field;
use crate::audio_properties;
use crate::lyrics_normalize;
use crate::lyrics_sidecar;
use crate::lyrics_tags;
use crate::models::TrackInput;
use crate::rating_tags;
use id3::{Tag, TagLike};
use metaflac::Tag as FlacTag;
use mp4ameta::Tag as Mp4Tag;
use std::path::{Path, PathBuf};

#[derive(Debug, Default, Clone)]
pub struct BasicTags {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub track_number: Option<i32>,
    pub total_tracks: Option<i32>,
    pub disc_number: Option<i32>,
    pub total_discs: Option<i32>,
    pub year: Option<i32>,
    pub genre: Option<String>,
    pub duration_seconds: Option<f64>,
    pub rating: Option<u8>,
    pub lyrics: Option<lyrics_tags::RawLyrics>,
}

fn audio_extension(path: &Path) -> Option<String> {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
}

pub fn filename_title(path: &Path) -> String {
    path.file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Unknown Track")
        .to_string()
}

fn parse_year(value: &str) -> Option<i32> {
    let year_str = value.trim().get(..4)?;
    year_str.parse().ok()
}

/// Parse `N` or `N/M` track/disc strings into (number, total).
pub(crate) fn parse_number_pair(value: &str) -> (Option<i32>, Option<i32>) {
    let mut parts = value.split('/');
    let number = parts.next().and_then(|s| s.trim().parse().ok());
    let total = parts.next().and_then(|s| s.trim().parse().ok());
    (number, total)
}

fn first_vorbis_int(tag: &FlacTag, key: &str) -> Option<i32> {
    tag.get_vorbis(key)
        .and_then(|mut v| v.next().and_then(|s| s.trim().parse().ok()))
}

fn cache_embedded_art(
    app_data_dir: &Path,
    file_path: &str,
    bytes: &[u8],
    mime: &str,
) -> Option<String> {
    let ext = art_cache::ext_from_mime(mime);
    art_cache::write_bytes_to_art_cache(app_data_dir, file_path, bytes, ext)
        .ok()
        .map(|p| p.to_string_lossy().into_owned())
}

fn read_mp3_duration(path: &Path) -> Option<f64> {
    mp3_duration::from_path(path)
        .ok()
        .map(|duration| duration.as_secs_f64())
        .filter(|seconds| *seconds > 0.0)
}

fn read_id3_tags(
    path: &Path,
    duration_fallback: fn(&Path) -> Option<f64>,
) -> (BasicTags, Option<(Vec<u8>, String)>) {
    let mut tags = BasicTags::default();
    let mut art = None;

    if let Ok(tag) = Tag::read_from_path(path) {
        tags.title = tag.title().map(|s| s.to_string());
        tags.artist = tag.artist().map(|s| s.to_string());
        tags.album = tag.album().map(|s| s.to_string());
        tags.album_artist = tag.album_artist().map(|s| s.to_string());
        tags.track_number = tag.track().map(|n| n as i32);
        tags.total_tracks = tag.total_tracks().map(|n| n as i32);
        tags.disc_number = tag.disc().map(|n| n as i32);
        tags.total_discs = tag.total_discs().map(|n| n as i32);
        tags.year = tag.year();
        tags.genre = tag.genre().map(|s| s.to_string());
        tags.rating = rating_tags::read_mp3_rating(&tag);

        if let Some(milliseconds) = tag.duration() {
            if milliseconds > 0 {
                tags.duration_seconds = Some(milliseconds as f64 / 1000.0);
            }
        }

        if let Some(picture) = tag.pictures().next() {
            art = Some((picture.data.clone(), picture.mime_type.clone()));
        }

        tags.lyrics = lyrics_tags::read_lyrics_from_id3(&tag);
    }

    if tags.duration_seconds.is_none() {
        tags.duration_seconds = duration_fallback(path);
    }

    (tags, art)
}

fn read_mp3_tags(path: &Path) -> (BasicTags, Option<(Vec<u8>, String)>) {
    read_id3_tags(path, read_mp3_duration)
}

fn read_wav_tags(path: &Path) -> (BasicTags, Option<(Vec<u8>, String)>) {
    read_id3_tags(path, read_wav_duration)
}

fn read_flac_tags(path: &Path) -> (BasicTags, Option<(Vec<u8>, String)>) {
    let mut tags = BasicTags::default();
    let mut art = None;

    let Ok(tag) = FlacTag::read_from_path(path) else {
        return (tags, art);
    };

    if let Some(mut v) = tag.get_vorbis("TITLE") {
        tags.title = v.next().map(|s| s.to_string());
    }
    if let Some(v) = tag.get_vorbis("ARTIST") {
        tags.artist = join_artist_field(v);
    }
    if let Some(mut v) = tag.get_vorbis("ALBUM") {
        tags.album = v.next().map(|s| s.to_string());
    }
    if let Some(v) = tag.get_vorbis("ALBUMARTIST") {
        tags.album_artist = join_artist_field(v);
    }
    if let Some(mut v) = tag.get_vorbis("TRACKNUMBER") {
        if let Some(value) = v.next() {
            let (number, slash_total) = parse_number_pair(value);
            tags.track_number = number;
            tags.total_tracks = slash_total;
        }
    }
    tags.total_tracks = first_vorbis_int(&tag, "TRACKTOTAL")
        .or_else(|| first_vorbis_int(&tag, "TOTALTRACKS"))
        .or(tags.total_tracks);
    if let Some(mut v) = tag.get_vorbis("DISCNUMBER") {
        if let Some(value) = v.next() {
            let (number, slash_total) = parse_number_pair(value);
            tags.disc_number = number;
            tags.total_discs = slash_total;
        }
    }
    tags.total_discs = first_vorbis_int(&tag, "DISCTOTAL")
        .or_else(|| first_vorbis_int(&tag, "TOTALDISCS"))
        .or(tags.total_discs);
    if let Some(mut v) = tag.get_vorbis("DATE") {
        if let Some(value) = v.next() {
            tags.year = parse_year(value);
        }
    }
    if let Some(mut v) = tag.get_vorbis("GENRE") {
        tags.genre = v.next().map(|s| s.to_string());
    }
    tags.rating = rating_tags::read_flac_rating(&tag);

    if let Some(streaminfo) = tag.get_streaminfo() {
        if streaminfo.sample_rate > 0 && streaminfo.total_samples > 0 {
            tags.duration_seconds =
                Some(streaminfo.total_samples as f64 / streaminfo.sample_rate as f64);
        }
    }

    if let Some(picture) = tag.pictures().next() {
        art = Some((picture.data.clone(), picture.mime_type.clone()));
    }

    tags.lyrics = lyrics_tags::read_lyrics_from_flac(&tag);

    (tags, art)
}

fn read_mp4_tags(path: &Path) -> (BasicTags, Option<(Vec<u8>, String)>) {
    let mut tags = BasicTags::default();
    let mut art = None;

    let Ok(tag) = Mp4Tag::read_from_path(path) else {
        return (tags, art);
    };

    tags.title = tag.title().map(|s| s.to_string());
    tags.artist = tag.artist().map(|s| s.to_string());
    tags.album = tag.album().map(|s| s.to_string());
    tags.album_artist = tag.album_artist().map(|s| s.to_string());
    tags.track_number = tag.track_number().map(|n| n as i32);
    tags.total_tracks = tag.total_tracks().map(|n| n as i32);
    tags.disc_number = tag.disc_number().map(|n| n as i32);
    tags.total_discs = tag.total_discs().map(|n| n as i32);
    tags.year = tag.year().and_then(|value| parse_year(value));
    tags.genre = tag.genre().map(|s| s.to_string());
    tags.rating = rating_tags::read_m4a_rating(&tag);
    let duration = tag.duration().as_secs_f64();
    if duration > 0.0 {
        tags.duration_seconds = Some(duration);
    }

    if let Some(picture) = tag.artwork() {
        let mime = match picture.fmt {
            mp4ameta::ImgFmt::Png => "image/png",
            mp4ameta::ImgFmt::Jpeg => "image/jpeg",
            mp4ameta::ImgFmt::Bmp => "image/bmp",
        };
        art = Some((picture.data.to_vec(), mime.to_string()));
    }

    tags.lyrics = lyrics_tags::read_lyrics_from_mp4(&tag);

    (tags, art)
}

fn read_wav_duration(path: &Path) -> Option<f64> {
    let data = std::fs::read(path).ok()?;
    if data.len() < 44 || &data[0..4] != b"RIFF" || &data[8..12] != b"WAVE" {
        return None;
    }

    let mut offset = 12usize;
    let mut byte_rate = None;
    let mut data_size = None;

    while offset + 8 <= data.len() {
        let chunk_id = &data[offset..offset + 4];
        let chunk_size = u32::from_le_bytes(data[offset + 4..offset + 8].try_into().ok()?) as usize;
        offset += 8;
        if offset + chunk_size > data.len() {
            break;
        }

        if chunk_id == b"fmt " && chunk_size >= 16 {
            byte_rate = Some(u32::from_le_bytes(
                data[offset + 8..offset + 12].try_into().ok()?,
            ));
        } else if chunk_id == b"data" {
            data_size = Some(chunk_size);
        }

        offset += chunk_size + (chunk_size % 2);
    }

    if let (Some(rate), Some(size)) = (byte_rate, data_size) {
        if rate > 0 {
            return Some(size as f64 / rate as f64);
        }
    }

    None
}

pub fn read_basic_tags(path: &Path) -> BasicTags {
    let ext = match audio_extension(path) {
        Some(e) => e,
        None => return BasicTags::default(),
    };

    let (tags, _) = match ext.as_str() {
        "mp3" => read_mp3_tags(path),
        "flac" => read_flac_tags(path),
        "m4a" | "aac" | "mp4" => read_mp4_tags(path),
        "wav" => read_wav_tags(path),
        "ogg" | "opus" => crate::vorbis_container::read_vorbis_container_tags(path),
        _ => (BasicTags::default(), None),
    };

    tags
}

pub fn parse_track_metadata(
    app_data_dir: &Path,
    file_path: &str,
    lyrics_sidecar_enabled: bool,
) -> Result<TrackInput, String> {
    let path = PathBuf::from(file_path);
    if !path.is_file() {
        return Err(format!("File not found: {file_path}"));
    }

    let ext = audio_extension(&path).unwrap_or_default();
    let (tags, art) = match ext.as_str() {
        "mp3" => read_mp3_tags(&path),
        "flac" => read_flac_tags(&path),
        "m4a" | "aac" | "mp4" => read_mp4_tags(&path),
        "wav" => read_wav_tags(&path),
        "ogg" | "opus" => crate::vorbis_container::read_vorbis_container_tags(&path),
        _ => (BasicTags::default(), None),
    };

    let art_path =
        art.and_then(|(bytes, mime)| cache_embedded_art(app_data_dir, file_path, &bytes, &mime));

    let audio = audio_properties::read_audio_properties(&path);

    Ok(TrackInput {
        title: tags.title.unwrap_or_else(|| filename_title(&path)),
        artist: tags.artist,
        album: tags.album,
        album_artist: tags.album_artist,
        track_number: tags.track_number,
        total_tracks: tags.total_tracks,
        disc_number: tags.disc_number,
        total_discs: tags.total_discs,
        year: tags.year,
        genre: tags.genre,
        duration_seconds: tags.duration_seconds,
        sample_rate: audio.sample_rate,
        bitrate: audio.bitrate,
        codec: audio.codec,
        file_path: file_path.to_string(),
        art_path,
        rating: tags.rating,
        lyrics: {
            let embedded = tags.lyrics.map(lyrics_normalize::normalize_embedded_lyrics);
            let sidecar = if lyrics_sidecar_enabled {
                lyrics_sidecar::read_lyrics_sidecar(&path)
                    .map(lyrics_normalize::normalize_sidecar_lyrics)
            } else {
                None
            };
            lyrics_normalize::resolve_embedded_and_sidecar_lyrics(embedded, sidecar)
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_fixtures::wav;
    use std::fs;

    #[test]
    fn join_artist_field_joins_flac_values() {
        assert_eq!(join_artist_field(["A", " B "]), Some("A; B".to_string()));
    }

    #[test]
    fn filename_title_strips_extension() {
        assert_eq!(filename_title(Path::new("/music/My Song.mp3")), "My Song");
    }

    #[test]
    fn parse_number_pair_reads_slash_totals() {
        assert_eq!(parse_number_pair("3"), (Some(3), None));
        assert_eq!(parse_number_pair("3/12"), (Some(3), Some(12)));
        assert_eq!(parse_number_pair(" 1 / 10 "), (Some(1), Some(10)));
        assert_eq!(parse_number_pair(""), (None, None));
    }

    #[test]
    fn parse_track_metadata_falls_back_to_filename() {
        let dir = std::env::temp_dir().join(format!("spiral-meta-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let file = dir.join("Plain.wav");
        let mut f = std::fs::File::create(&file).unwrap();
        use std::io::Write;
        writeln!(f, "not a real wav").unwrap();

        let app_data = dir.join("appdata");
        let result = parse_track_metadata(&app_data, file.to_str().unwrap(), true).unwrap();
        assert_eq!(result.title, "Plain");
        assert_eq!(result.file_path, file.to_string_lossy());
        assert_eq!(result.rating, None);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_mp3_duration_returns_none_for_invalid_file() {
        let dir = std::env::temp_dir().join(format!("spiral-mp3-dur-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let file = dir.join("not-mp3.txt");
        std::fs::write(&file, b"not audio").unwrap();

        assert_eq!(read_mp3_duration(&file), None);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn parse_track_metadata_reads_mp3_popm_rating() {
        use crate::metadata_backup::MetadataBackupConfig;
        use std::fs;
        use std::io::Write;

        let dir = std::env::temp_dir().join(format!("spiral-meta-popm-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let audio = dir.join("rated.mp3");
        let mut f = fs::File::create(&audio).unwrap();
        f.write_all(&[0xFF, 0xFB, 0x90, 0x00, 0x00, 0x00, 0x00, 0x00])
            .unwrap();

        let backup_config = MetadataBackupConfig {
            enabled: false,
            retention_days: 14,
        };
        rating_tags::write_rating_to_file(&audio, 204, &backup_config).unwrap();

        let app_data = dir.join("appdata");
        let result = parse_track_metadata(&app_data, audio.to_str().unwrap(), true).unwrap();
        assert_eq!(result.rating, Some(204));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_wav_tags_reads_committed_fixture() {
        let (tags, _) = read_wav_tags(&wav::tagged_fixture_path());
        assert_eq!(tags.title.as_deref(), Some("WAV Title"));
        assert_eq!(tags.artist.as_deref(), Some("WAV Artist"));
        assert_eq!(tags.album.as_deref(), Some("WAV Album"));
        assert_eq!(tags.album_artist.as_deref(), Some("WAV Album Artist"));
        assert_eq!(tags.track_number, Some(3));
        assert_eq!(tags.disc_number, Some(2));
        assert_eq!(tags.year, Some(2020));
        assert_eq!(tags.genre.as_deref(), Some("Jazz"));
        assert!(tags.duration_seconds.unwrap() > 0.0);
    }

    #[test]
    fn read_wav_tags_falls_back_to_duration_for_untagged() {
        let dir = std::env::temp_dir().join(format!("spiral-wav-untagged-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        let audio = dir.join("plain.wav");
        wav::write_minimal(&audio);

        let (tags, art) = read_wav_tags(&audio);
        assert!(tags.title.is_none());
        assert!(tags.artist.is_none());
        assert!(art.is_none());
        assert!(tags.duration_seconds.unwrap() > 0.0);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_wav_tags_ignores_corrupt_id3_and_keeps_duration() {
        let dir = std::env::temp_dir().join(format!("spiral-wav-corrupt-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        let audio = dir.join("corrupt.wav");
        wav::write_minimal(&audio);
        let mut bytes = std::fs::read(&audio).unwrap();
        bytes.extend_from_slice(b"ID3\x00\x00\x00\x10garbage!!!!");
        std::fs::write(&audio, bytes).unwrap();

        let (tags, art) = read_wav_tags(&audio);
        assert!(tags.title.is_none());
        assert!(art.is_none());
        assert!(tags.duration_seconds.unwrap() > 0.0);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn parse_track_metadata_reads_wav_id3_rating() {
        use crate::metadata_backup::MetadataBackupConfig;

        let dir = std::env::temp_dir().join(format!("spiral-wav-popm-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        let audio = dir.join("rated.wav");
        fs::copy(wav::tagged_fixture_path(), &audio).unwrap();

        let backup_config = MetadataBackupConfig {
            enabled: false,
            retention_days: 14,
        };
        rating_tags::write_rating_to_file(&audio, 180, &backup_config).unwrap();

        let app_data = dir.join("appdata");
        let result = parse_track_metadata(&app_data, audio.to_str().unwrap(), true).unwrap();
        assert_eq!(result.rating, Some(180));
        assert_eq!(result.title, "WAV Title");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn parse_track_metadata_reads_embedded_flac_lyrics() {
        use metaflac::Tag as FlacTag;
        use std::path::PathBuf;

        let dir = std::env::temp_dir().join(format!("spiral-meta-lyrics-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        let audio = dir.join("lyrics.flac");
        let src = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/minimal.flac");
        fs::copy(src, &audio).unwrap();
        let mut tag = FlacTag::read_from_path(&audio).unwrap();
        tag.set_vorbis("LYRICS", vec!["Embedded line one\nEmbedded line two"]);
        tag.save().unwrap();

        let app_data = dir.join("appdata");
        let result = parse_track_metadata(&app_data, audio.to_str().unwrap(), true).unwrap();
        let lyrics = result.lyrics.expect("lyrics payload");
        assert_eq!(lyrics.format, crate::models::LyricsFormat::Plain);
        assert_eq!(lyrics.source, Some(crate::models::LyricsSource::Embedded));
        assert_eq!(lyrics.plain_text, "Embedded line one\nEmbedded line two");
        assert_eq!(lyrics.lines.len(), 2);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn parse_track_metadata_reads_embedded_lrc_as_line_synced() {
        use metaflac::Tag as FlacTag;
        use std::path::PathBuf;

        let dir = std::env::temp_dir().join(format!("spiral-meta-lrc-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        let audio = dir.join("synced.flac");
        let src = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/minimal.flac");
        fs::copy(src, &audio).unwrap();
        let mut tag = FlacTag::read_from_path(&audio).unwrap();
        tag.set_vorbis("LYRICS", vec!["[00:05.00] Synced line"]);
        tag.save().unwrap();

        let app_data = dir.join("appdata");
        let result = parse_track_metadata(&app_data, audio.to_str().unwrap(), true).unwrap();
        let lyrics = result.lyrics.expect("lyrics payload");
        assert_eq!(lyrics.format, crate::models::LyricsFormat::LineSynced);
        assert_eq!(lyrics.plain_text, "Synced line");
        assert_eq!(lyrics.lines[0].start_ms, Some(5_000));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn parse_track_metadata_reads_sidecar_when_tags_have_no_lyrics() {
        use std::io::Write;
        use std::path::PathBuf;

        let dir = std::env::temp_dir().join(format!("spiral-meta-sidecar-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        let audio = dir.join("sidecar.flac");
        let src = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/minimal.flac");
        fs::copy(src, &audio).unwrap();

        let sidecar = dir.join("sidecar.lrc");
        let mut file = std::fs::File::create(&sidecar).unwrap();
        writeln!(file, "[00:08.00] Sidecar lyrics").unwrap();

        let app_data = dir.join("appdata");
        let result = parse_track_metadata(&app_data, audio.to_str().unwrap(), true).unwrap();
        let lyrics = result.lyrics.expect("sidecar lyrics");
        assert_eq!(lyrics.format, crate::models::LyricsFormat::LineSynced);
        assert_eq!(lyrics.source, Some(crate::models::LyricsSource::Sidecar));
        assert_eq!(lyrics.plain_text, "Sidecar lyrics");
        assert_eq!(lyrics.lines[0].start_ms, Some(8_000));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn parse_track_metadata_prefers_line_synced_sidecar_over_plain_tags() {
        use metaflac::Tag as FlacTag;
        use std::io::Write;
        use std::path::PathBuf;

        let dir =
            std::env::temp_dir().join(format!("spiral-meta-prefer-sidecar-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        let audio = dir.join("prefer.flac");
        let src = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/minimal.flac");
        fs::copy(src, &audio).unwrap();
        let mut tag = FlacTag::read_from_path(&audio).unwrap();
        tag.set_vorbis("LYRICS", vec!["Same line"]);
        tag.save().unwrap();

        let sidecar = dir.join("prefer.lrc");
        let mut file = std::fs::File::create(&sidecar).unwrap();
        writeln!(file, "[00:04.00] Same line").unwrap();

        let app_data = dir.join("appdata");
        let result = parse_track_metadata(&app_data, audio.to_str().unwrap(), true).unwrap();
        let lyrics = result.lyrics.expect("lyrics");
        assert_eq!(lyrics.format, crate::models::LyricsFormat::LineSynced);
        assert_eq!(lyrics.source, Some(crate::models::LyricsSource::Sidecar));
        assert_eq!(lyrics.plain_text, "Same line");
        assert_eq!(lyrics.lines[0].start_ms, Some(4_000));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn parse_track_metadata_keeps_tags_when_same_format_content_differs() {
        use metaflac::Tag as FlacTag;
        use std::io::Write;
        use std::path::PathBuf;

        let dir = std::env::temp_dir().join(format!("spiral-meta-tags-win-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        let audio = dir.join("conflict.flac");
        let src = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/minimal.flac");
        fs::copy(src, &audio).unwrap();
        let mut tag = FlacTag::read_from_path(&audio).unwrap();
        tag.set_vorbis("LYRICS", vec!["[00:01.00] From tags"]);
        tag.save().unwrap();

        let sidecar = dir.join("conflict.lrc");
        let mut file = std::fs::File::create(&sidecar).unwrap();
        writeln!(file, "[00:02.00] From sidecar").unwrap();

        let app_data = dir.join("appdata");
        let result = parse_track_metadata(&app_data, audio.to_str().unwrap(), true).unwrap();
        let lyrics = result.lyrics.expect("lyrics");
        assert_eq!(lyrics.format, crate::models::LyricsFormat::LineSynced);
        assert_eq!(lyrics.source, Some(crate::models::LyricsSource::Embedded));
        assert_eq!(lyrics.plain_text, "From tags");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn parse_track_metadata_skips_sidecar_when_disabled() {
        use std::io::Write;
        use std::path::PathBuf;

        let dir =
            std::env::temp_dir().join(format!("spiral-meta-sidecar-off-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        let audio = dir.join("sidecar.flac");
        let src = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/minimal.flac");
        fs::copy(src, &audio).unwrap();

        let sidecar = dir.join("sidecar.lrc");
        let mut file = std::fs::File::create(&sidecar).unwrap();
        writeln!(file, "[00:08.00] Sidecar lyrics").unwrap();

        let app_data = dir.join("appdata");
        let result = parse_track_metadata(&app_data, audio.to_str().unwrap(), false).unwrap();
        assert!(result.lyrics.is_none());

        let _ = std::fs::remove_dir_all(&dir);
    }
}
