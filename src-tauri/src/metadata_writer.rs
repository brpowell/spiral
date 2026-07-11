use crate::artist_tags::{join_artist_field, parse_artist_field};
use crate::lyrics_tags;
use crate::metadata_backup::{self, MetadataBackupConfig};
use crate::models::TrackMetadataUpdate;
use id3::frame::{Picture, PictureType};
use id3::{ErrorKind, Tag, TagLike};
use image::ImageFormat;
use metaflac::block::PictureType as FlacPictureType;
use metaflac::Tag as FlacTag;
use mp4ameta::{Img, Tag as Mp4Tag};
use std::io::Cursor;
use std::path::{Path, PathBuf};

#[derive(Debug)]
pub enum MetadataWriteError {
    UnsupportedFormat(String),
    ReadOnly(String),
    Io(String),
    Tag(String),
}

impl MetadataWriteError {
    pub fn to_message(self) -> String {
        match self {
            Self::UnsupportedFormat(msg) => msg,
            Self::ReadOnly(msg) => msg,
            Self::Io(msg) => msg,
            Self::Tag(msg) => msg,
        }
    }
}

pub(crate) fn ensure_writable(path: &Path) -> Result<(), MetadataWriteError> {
    if !path.exists() {
        return Err(MetadataWriteError::Io(format!(
            "File not found: {}",
            path.display()
        )));
    }
    let meta = std::fs::metadata(path)
        .map_err(|e| MetadataWriteError::Io(format!("Cannot access file: {e}")))?;
    if meta.permissions().readonly() {
        return Err(MetadataWriteError::ReadOnly(
            "This file is read-only. Remove the read-only flag or choose a writable copy."
                .to_string(),
        ));
    }
    Ok(())
}

pub(crate) fn audio_extension(path: &Path) -> Option<String> {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
}

fn read_image_bytes(art_path: &str) -> Result<Vec<u8>, MetadataWriteError> {
    std::fs::read(art_path)
        .map_err(|e| MetadataWriteError::Io(format!("Failed to read album art: {e}")))
}

fn mime_for_path(path: &str) -> String {
    let lower = path.to_ascii_lowercase();
    if lower.ends_with(".png") {
        "image/png".to_string()
    } else if lower.ends_with(".webp") {
        "image/webp".to_string()
    } else {
        "image/jpeg".to_string()
    }
}

/// Build MPEG-4 cover art. WebP is converted to JPEG; PNG and JPEG pass through.
fn mp4_artwork(art_path: &str, bytes: Vec<u8>) -> Result<Img<Vec<u8>>, MetadataWriteError> {
    let lower = art_path.to_ascii_lowercase();
    if lower.ends_with(".png") {
        return Ok(Img::png(bytes));
    }
    if lower.ends_with(".webp") {
        let img = image::load_from_memory(&bytes).map_err(|e| {
            MetadataWriteError::Tag(format!("Failed to decode WebP cover art: {e}"))
        })?;
        let mut jpeg = Vec::new();
        img.write_to(&mut Cursor::new(&mut jpeg), ImageFormat::Jpeg)
            .map_err(|e| MetadataWriteError::Tag(format!("Failed to encode cover art as JPEG: {e}")))?;
        return Ok(Img::jpeg(jpeg));
    }
    Ok(Img::jpeg(bytes))
}

fn joined_artist_tag(raw: &str) -> Option<String> {
    join_artist_field(parse_artist_field(raw))
}

fn apply_common_mp4(tag: &mut Mp4Tag, metadata: &TrackMetadataUpdate) {
    tag.set_title(metadata.title.clone());
    if let Some(artist) = &metadata.artist {
        if let Some(joined) = joined_artist_tag(artist) {
            tag.set_artist(joined);
        }
    }
    if let Some(album) = &metadata.album {
        tag.set_album(album.clone());
    }
    if let Some(album_artist) = &metadata.album_artist {
        if let Some(joined) = joined_artist_tag(album_artist) {
            tag.set_album_artist(joined);
        }
    }
    if let Some(n) = metadata.track_number {
        tag.set_track_number(n as u16);
    }
    if let Some(n) = metadata.disc_number {
        tag.set_disc_number(n as u16);
    }
    if let Some(year) = metadata.year {
        tag.set_year(year.to_string());
    }
    if let Some(genre) = &metadata.genre {
        tag.set_genre(genre.clone());
    }
}

fn temp_path_for(path: &Path) -> PathBuf {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "audio".to_string());
    path.with_file_name(format!(".{name}.spiral.tmp"))
}

/// Write to a temp copy, verify, then atomically replace the original (optional `.bak`).
pub(crate) fn write_via_temp<F>(
    path: &Path,
    backup_config: &MetadataBackupConfig,
    write: F,
) -> Result<(), MetadataWriteError>
where
    F: FnOnce(&Path) -> Result<(), MetadataWriteError>,
{
    let temp = temp_path_for(path);
    let backup = metadata_backup::backup_path_for(path);

    if temp.exists() {
        std::fs::remove_file(&temp)
            .map_err(|e| MetadataWriteError::Io(format!("Failed to reset temp file: {e}")))?;
    }

    std::fs::copy(path, &temp)
        .map_err(|e| MetadataWriteError::Io(format!("Failed to copy file for safe write: {e}")))?;

    write(&temp)?;

    if backup_config.enabled {
        if backup.exists() {
            std::fs::remove_file(&backup)
                .map_err(|e| MetadataWriteError::Io(format!("Failed to remove old backup: {e}")))?;
        }
        std::fs::copy(path, &backup).map_err(|e| {
            MetadataWriteError::Io(format!("Failed to create backup {}: {e}", backup.display()))
        })?;
    }

    std::fs::rename(&temp, path).map_err(|e| {
        MetadataWriteError::Io(format!("Failed to replace audio file: {e}"))
    })?;

    Ok(())
}

/// Read existing ID3 tags, or start from an empty tag when the file has none.
pub(crate) fn read_id3_tag(path: &Path) -> Result<Tag, MetadataWriteError> {
    match Tag::read_from_path(path) {
        Ok(tag) => Ok(tag),
        Err(id3::Error {
            kind: ErrorKind::NoTag, ..
        }) => Ok(Tag::new()),
        Err(e) => Err(MetadataWriteError::Tag(format!(
            "Failed to read ID3 tags: {e}"
        ))),
    }
}

pub(crate) fn verify_m4a_readable(path: &Path) -> Result<(), MetadataWriteError> {
    Mp4Tag::read_from_path(path).map_err(|e| {
        MetadataWriteError::Tag(format!("Written file failed verification read: {e}"))
    })?;
    Ok(())
}

fn apply_id3_metadata(tag: &mut Tag, metadata: &TrackMetadataUpdate) -> Result<(), MetadataWriteError> {
    tag.set_title(metadata.title.clone());
    if let Some(artist) = &metadata.artist {
        if let Some(joined) = joined_artist_tag(artist) {
            tag.set_artist(joined);
        }
    }
    if let Some(album) = &metadata.album {
        tag.set_album(album.clone());
    }
    if let Some(album_artist) = &metadata.album_artist {
        if let Some(joined) = joined_artist_tag(album_artist) {
            tag.set_text("TPE2", &joined);
        }
    }
    if let Some(n) = metadata.track_number {
        tag.set_track(n as u32);
    }
    if let Some(n) = metadata.disc_number {
        tag.set_disc(n as u32);
    }
    if let Some(year) = metadata.year {
        tag.set_year(year as i32);
    }
    if let Some(genre) = &metadata.genre {
        tag.set_genre(genre.clone());
    }

    if metadata.art_changed {
        tag.remove_all_pictures();
        if let Some(art_path) = &metadata.art_path {
            let data = read_image_bytes(art_path)?;
            let picture = Picture {
                mime_type: mime_for_path(art_path),
                picture_type: PictureType::CoverFront,
                description: String::new(),
                data,
            };
            tag.add_frame(picture);
        }
    }

    if metadata.lyrics_changed {
        let (text, remove) =
            lyrics_tags::lyrics_text_for_embed(metadata, lyrics_tags::LyricsEmbedKind::SyncCapable);
        lyrics_tags::apply_lyrics_to_id3(tag, &text, remove);
    }

    Ok(())
}

fn write_id3(
    path: &Path,
    metadata: &TrackMetadataUpdate,
    backup_config: &MetadataBackupConfig,
    format_label: &str,
) -> Result<(), MetadataWriteError> {
    // TODO: optional ID3v2.4 multi-TPE1 frames (player support is inconsistent).
    write_via_temp(path, backup_config, |target| {
        let mut tag = read_id3_tag(target)?;
        apply_id3_metadata(&mut tag, metadata)?;
        tag.write_to_path(target, id3::Version::Id3v24)
            .map_err(|e| MetadataWriteError::Tag(format!("Failed to write {format_label} tags: {e}")))?;
        Ok(())
    })
}

fn write_mp3(
    path: &Path,
    metadata: &TrackMetadataUpdate,
    backup_config: &MetadataBackupConfig,
) -> Result<(), MetadataWriteError> {
    write_id3(path, metadata, backup_config, "MP3")
}

fn write_wav(
    path: &Path,
    metadata: &TrackMetadataUpdate,
    backup_config: &MetadataBackupConfig,
) -> Result<(), MetadataWriteError> {
    write_id3(path, metadata, backup_config, "WAV")
}

fn write_flac(
    path: &Path,
    metadata: &TrackMetadataUpdate,
    backup_config: &MetadataBackupConfig,
) -> Result<(), MetadataWriteError> {
    write_via_temp(path, backup_config, |target| {
        let mut tag = FlacTag::read_from_path(target)
            .map_err(|e| MetadataWriteError::Tag(format!("Failed to read FLAC tags: {e}")))?;

        tag.set_vorbis("TITLE", vec![metadata.title.clone()]);
        if let Some(artist) = &metadata.artist {
            let values = parse_artist_field(artist);
            if !values.is_empty() {
                tag.set_vorbis("ARTIST", values);
            }
        }
        if let Some(album) = &metadata.album {
            tag.set_vorbis("ALBUM", vec![album.clone()]);
        }
        if let Some(album_artist) = &metadata.album_artist {
            let values = parse_artist_field(album_artist);
            if !values.is_empty() {
                tag.set_vorbis("ALBUMARTIST", values);
            }
        }
        if let Some(n) = metadata.track_number {
            tag.set_vorbis("TRACKNUMBER", vec![n.to_string()]);
        }
        if let Some(n) = metadata.disc_number {
            tag.set_vorbis("DISCNUMBER", vec![n.to_string()]);
        }
        if let Some(year) = metadata.year {
            tag.set_vorbis("DATE", vec![year.to_string()]);
        }
        if let Some(genre) = &metadata.genre {
            tag.set_vorbis("GENRE", vec![genre.clone()]);
        }

        if metadata.art_changed {
            tag.remove_picture_type(FlacPictureType::CoverFront);
            if let Some(art_path) = &metadata.art_path {
                let data = read_image_bytes(art_path)?;
                tag.add_picture(mime_for_path(art_path), FlacPictureType::CoverFront, data);
            }
        }

        if metadata.lyrics_changed {
            let (text, remove) = lyrics_tags::lyrics_text_for_embed(
                metadata,
                lyrics_tags::LyricsEmbedKind::SyncCapable,
            );
            lyrics_tags::apply_lyrics_to_flac(&mut tag, &text, remove);
        }

        tag.save()
            .map_err(|e| MetadataWriteError::Tag(format!("Failed to write FLAC tags: {e}")))?;
        Ok(())
    })
}

fn write_m4a_tag(target: &Path, metadata: &TrackMetadataUpdate) -> Result<(), MetadataWriteError> {
    let mut tag = Mp4Tag::read_from_path(target)
        .map_err(|e| MetadataWriteError::Tag(format!("Failed to read M4A tags: {e}")))?;

    apply_common_mp4(&mut tag, metadata);

    if metadata.art_changed {
        tag.remove_artworks();
        if let Some(art_path) = &metadata.art_path {
            let data = read_image_bytes(art_path)?;
            tag.set_artwork(mp4_artwork(art_path, data)?);
        }
    }

    if metadata.lyrics_changed {
        let (text, remove) =
            lyrics_tags::lyrics_text_for_embed(metadata, lyrics_tags::LyricsEmbedKind::Mp4);
        lyrics_tags::apply_lyrics_to_mp4(&mut tag, &text, remove);
    }

    tag.write_to_path(target)
        .map_err(|e| MetadataWriteError::Tag(format!("Failed to write M4A tags: {e}")))?;
    verify_m4a_readable(target)?;
    Ok(())
}

fn write_m4a(
    path: &Path,
    metadata: &TrackMetadataUpdate,
    backup_config: &MetadataBackupConfig,
) -> Result<(), MetadataWriteError> {
    write_via_temp(path, backup_config, |target| write_m4a_tag(target, metadata))
}

fn write_vorbis_container(
    path: &Path,
    metadata: &TrackMetadataUpdate,
    backup_config: &MetadataBackupConfig,
) -> Result<(), MetadataWriteError> {
    write_via_temp(path, backup_config, |target| {
        crate::vorbis_container::write_vorbis_container_tag(target, metadata)
    })
}

/// Embed or clear lyrics without changing other tags (import replace projections).
pub fn write_lyrics_projection(
    path: &Path,
    lyrics: Option<&crate::models::TrackLyricsInput>,
    backup_config: &MetadataBackupConfig,
) -> Result<(), MetadataWriteError> {
    ensure_writable(path)?;

    match audio_extension(path).as_deref() {
        Some("mp3") => write_via_temp(path, backup_config, |target| {
            let mut tag = read_id3_tag(target)?;
            let (text, remove) = lyrics_tags::lyrics_text_for_embed_input(
                lyrics,
                lyrics_tags::LyricsEmbedKind::SyncCapable,
            );
            lyrics_tags::apply_lyrics_to_id3(&mut tag, &text, remove);
            tag.write_to_path(target, id3::Version::Id3v24)
                .map_err(|e| MetadataWriteError::Tag(format!("Failed to write MP3 lyrics: {e}")))?;
            Ok(())
        }),
        Some("wav") => write_via_temp(path, backup_config, |target| {
            let mut tag = read_id3_tag(target)?;
            let (text, remove) = lyrics_tags::lyrics_text_for_embed_input(
                lyrics,
                lyrics_tags::LyricsEmbedKind::SyncCapable,
            );
            lyrics_tags::apply_lyrics_to_id3(&mut tag, &text, remove);
            tag.write_to_path(target, id3::Version::Id3v24)
                .map_err(|e| MetadataWriteError::Tag(format!("Failed to write WAV lyrics: {e}")))?;
            Ok(())
        }),
        Some("flac") => write_via_temp(path, backup_config, |target| {
            let mut tag = FlacTag::read_from_path(target)
                .map_err(|e| MetadataWriteError::Tag(format!("Failed to read FLAC tags: {e}")))?;
            let (text, remove) = lyrics_tags::lyrics_text_for_embed_input(
                lyrics,
                lyrics_tags::LyricsEmbedKind::SyncCapable,
            );
            lyrics_tags::apply_lyrics_to_flac(&mut tag, &text, remove);
            tag.save()
                .map_err(|e| MetadataWriteError::Tag(format!("Failed to write FLAC lyrics: {e}")))?;
            Ok(())
        }),
        Some("m4a") | Some("aac") | Some("mp4") => write_via_temp(path, backup_config, |target| {
            let mut tag = Mp4Tag::read_from_path(target)
                .map_err(|e| MetadataWriteError::Tag(format!("Failed to read M4A tags: {e}")))?;
            let (text, remove) =
                lyrics_tags::lyrics_text_for_embed_input(lyrics, lyrics_tags::LyricsEmbedKind::Mp4);
            lyrics_tags::apply_lyrics_to_mp4(&mut tag, &text, remove);
            tag.write_to_path(target)
                .map_err(|e| MetadataWriteError::Tag(format!("Failed to write M4A lyrics: {e}")))?;
            verify_m4a_readable(target)?;
            Ok(())
        }),
        Some("ogg") | Some("opus") => write_via_temp(path, backup_config, |target| {
            crate::vorbis_container::write_vorbis_container_lyrics(target, lyrics)
        }),
        Some(ext) => Err(MetadataWriteError::UnsupportedFormat(format!(
            "Lyrics projection is not supported for .{ext} files."
        ))),
        None => Err(MetadataWriteError::UnsupportedFormat(
            "Unknown audio format.".to_string(),
        )),
    }
}

pub fn write_track_metadata(
    path: &Path,
    metadata: &TrackMetadataUpdate,
    backup_config: &MetadataBackupConfig,
) -> Result<(), MetadataWriteError> {
    ensure_writable(path)?;

    match audio_extension(path).as_deref() {
        Some("mp3") => write_mp3(path, metadata, backup_config),
        Some("flac") => write_flac(path, metadata, backup_config),
        Some("m4a") | Some("aac") | Some("mp4") => write_m4a(path, metadata, backup_config),
        Some("wav") => write_wav(path, metadata, backup_config),
        Some("ogg") | Some("opus") => write_vorbis_container(path, metadata, backup_config),
        Some(ext) => Err(MetadataWriteError::UnsupportedFormat(format!(
            "Metadata editing is not supported for .{ext} files."
        ))),
        None => Err(MetadataWriteError::UnsupportedFormat(
            "Unknown audio format.".to_string(),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_fixtures::{m4a, wav};
    use std::fs;
    use std::io::Write;

    #[test]
    fn mp3_write_tags_on_file_without_id3() {
        let dir = std::env::temp_dir().join(format!("spiral-mp3-notag-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let audio = dir.join("tagless.mp3");
        // Minimal MPEG-1 Layer III frame header (no ID3 tag).
        let mut f = fs::File::create(&audio).unwrap();
        f.write_all(&[0xFF, 0xFB, 0x90, 0x00, 0x00, 0x00, 0x00, 0x00])
            .unwrap();

        let metadata = TrackMetadataUpdate {
            title: "Tagged Title".to_string(),
            artist: Some("Tagged Artist".to_string()),
            album: Some("Tagged Album".to_string()),
            album_artist: None,
            track_number: Some(1),
            disc_number: None,
            year: Some(2024),
            genre: Some("Rock".to_string()),
            art_path: None,
            art_changed: false,
            lyrics: None,
            lyrics_changed: false,
        };

        let backup_config = MetadataBackupConfig {
            enabled: false,
            retention_days: 14,
        };
        write_mp3(&audio, &metadata, &backup_config).expect("write mp3 metadata");

        let tag = Tag::read_from_path(&audio).expect("re-read after write");
        assert_eq!(tag.title().as_deref(), Some("Tagged Title"));
        assert_eq!(tag.artist().as_deref(), Some("Tagged Artist"));
        assert_eq!(tag.album().as_deref(), Some("Tagged Album"));
        assert_eq!(tag.genre().as_deref(), Some("Rock"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn mp3_write_multi_artist_uses_semicolon_join() {
        let dir = std::env::temp_dir().join(format!("spiral-mp3-multi-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let audio = dir.join("multi.mp3");
        let mut f = fs::File::create(&audio).unwrap();
        f.write_all(&[0xFF, 0xFB, 0x90, 0x00, 0x00, 0x00, 0x00, 0x00])
            .unwrap();

        let metadata = TrackMetadataUpdate {
            title: "Title".to_string(),
            artist: Some("Alice; Bob".to_string()),
            album: None,
            album_artist: Some("Band A; Band B".to_string()),
            track_number: None,
            disc_number: None,
            year: None,
            genre: None,
            art_path: None,
            art_changed: false,
            lyrics: None,
            lyrics_changed: false,
        };

        let backup_config = MetadataBackupConfig {
            enabled: false,
            retention_days: 14,
        };
        write_mp3(&audio, &metadata, &backup_config).expect("write mp3 metadata");

        let tag = Tag::read_from_path(&audio).expect("re-read after write");
        assert_eq!(tag.artist().as_deref(), Some("Alice; Bob"));
        assert_eq!(
            tag.get("TPE2").and_then(|f| f.content().text()).map(|s| s.to_string()),
            Some("Band A; Band B".to_string())
        );

        let _ = fs::remove_dir_all(&dir);
    }

    fn copy_minimal_flac_fixture(dir: &Path) -> PathBuf {
        let src = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/minimal.flac");
        let dest = dir.join("test.flac");
        fs::copy(&src, &dest).expect("copy flac fixture");
        dest
    }

    #[test]
    fn flac_write_multi_artist_uses_native_vorbis_values() {
        let dir = std::env::temp_dir().join(format!("spiral-flac-multi-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let audio = copy_minimal_flac_fixture(&dir);
        let metadata = TrackMetadataUpdate {
            title: "Title".to_string(),
            artist: Some("Alice; Bob".to_string()),
            album: None,
            album_artist: None,
            track_number: None,
            disc_number: None,
            year: None,
            genre: None,
            art_path: None,
            art_changed: false,
            lyrics: None,
            lyrics_changed: false,
        };

        let backup_config = MetadataBackupConfig {
            enabled: false,
            retention_days: 14,
        };
        write_flac(&audio, &metadata, &backup_config).expect("write flac metadata");

        let tag = FlacTag::read_from_path(&audio).expect("re-read after write");
        let artists: Vec<String> = tag
            .get_vorbis("ARTIST")
            .into_iter()
            .flatten()
            .map(|s| s.to_string())
            .collect();
        assert_eq!(artists, vec!["Alice".to_string(), "Bob".to_string()]);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn mp4_write_metadata_uses_m4a_writer() {
        let dir = std::env::temp_dir().join(format!("spiral-mp4-meta-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let audio = m4a::copy_moov_before_mdat(&dir, "test.mp4");
        let metadata = TrackMetadataUpdate {
            title: "MP4 Title".to_string(),
            artist: Some("MP4 Artist".to_string()),
            album: None,
            album_artist: None,
            track_number: None,
            disc_number: None,
            year: None,
            genre: None,
            art_path: None,
            art_changed: false,
            lyrics: None,
            lyrics_changed: false,
        };

        let backup_config = MetadataBackupConfig {
            enabled: false,
            retention_days: 14,
        };
        write_track_metadata(&audio, &metadata, &backup_config).expect("write mp4 metadata");

        let tag = Mp4Tag::read_from_path(&audio).expect("re-read after write");
        assert_eq!(tag.title().as_deref(), Some("MP4 Title"));
        assert_eq!(tag.artist().as_deref(), Some("MP4 Artist"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn m4a_write_multi_artist_uses_semicolon_join() {
        let dir = std::env::temp_dir().join(format!("spiral-m4a-multi-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let audio = m4a::copy_moov_before_mdat(&dir, "test.m4a");
        let metadata = TrackMetadataUpdate {
            title: "Title".to_string(),
            artist: Some("Alice; Bob".to_string()),
            album: None,
            album_artist: None,
            track_number: None,
            disc_number: None,
            year: None,
            genre: None,
            art_path: None,
            art_changed: false,
            lyrics: None,
            lyrics_changed: false,
        };

        let backup_config = MetadataBackupConfig {
            enabled: false,
            retention_days: 14,
        };
        write_m4a(&audio, &metadata, &backup_config).expect("write m4a metadata");

        let tag = Mp4Tag::read_from_path(&audio).expect("re-read after write");
        assert_eq!(tag.artist().as_deref(), Some("Alice; Bob"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn m4a_write_artwork_preserves_playable_structure() {
        let dir = std::env::temp_dir().join(format!("spiral-meta-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let audio = m4a::copy_moov_before_mdat(&dir, "test.m4a");
        let art_path = dir.join("cover.jpg");
        let mut art_file = fs::File::create(&art_path).unwrap();
        // Minimal valid JPEG (1x1)
        art_file
            .write_all(&[
                0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00,
                0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xFF, 0xDB, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06,
                0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0A, 0x0C, 0x14, 0x0D,
                0x0C, 0x0B, 0x0B, 0x0C, 0x19, 0x12, 0x13, 0x0F, 0x14, 0x1D, 0x1A, 0x1F, 0x1E, 0x1D,
                0x1A, 0x1C, 0x1C, 0x20, 0x24, 0x2E, 0x27, 0x20, 0x22, 0x2C, 0x23, 0x1C, 0x1C, 0x28,
                0x37, 0x29, 0x2C, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1F, 0x27, 0x39, 0x3D, 0x38, 0x32,
                0x3C, 0x2E, 0x33, 0x34, 0x32, 0xFF, 0xC0, 0x00, 0x0B, 0x08, 0x00, 0x01, 0x00, 0x01,
                0x01, 0x01, 0x11, 0x00, 0xFF, 0xC4, 0x00, 0x1F, 0x00, 0x00, 0x01, 0x05, 0x01, 0x01,
                0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x02,
                0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x0B, 0xFF, 0xC4, 0x00, 0xB5, 0x10,
                0x00, 0x02, 0x01, 0x03, 0x03, 0x02, 0x04, 0x03, 0x05, 0x05, 0x04, 0x04, 0x00, 0x00,
                0x01, 0x7D, 0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06,
                0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xA1, 0x08, 0x23, 0x42,
                0xB1, 0xC1, 0x15, 0x52, 0xD1, 0xF0, 0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0A, 0x16,
                0x17, 0x18, 0x19, 0x1A, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2A, 0x34, 0x35, 0x36, 0x37,
                0x38, 0x39, 0x3A, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4A, 0x53, 0x54, 0x55,
                0x56, 0x57, 0x58, 0x59, 0x5A, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6A, 0x73,
                0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7A, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
                0x8A, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9A, 0xA2, 0xA3, 0xA4, 0xA5,
                0xA6, 0xA7, 0xA8, 0xA9, 0xAA, 0xB2, 0xB3, 0xB4, 0xB5, 0xB6, 0xB7, 0xB8, 0xB9, 0xBA,
                0xC2, 0xC3, 0xC4, 0xC5, 0xC6, 0xC7, 0xC8, 0xC9, 0xCA, 0xD2, 0xD3, 0xD4, 0xD5, 0xD6,
                0xD7, 0xD8, 0xD9, 0xDA, 0xE1, 0xE2, 0xE3, 0xE4, 0xE5, 0xE6, 0xE7, 0xE8, 0xE9, 0xEA,
                0xF1, 0xF2, 0xF3, 0xF4, 0xF5, 0xF6, 0xF7, 0xF8, 0xF9, 0xFA, 0xFF, 0xDA, 0x00, 0x0C,
                0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3F, 0x00, 0xFB, 0xD5, 0xDB, 0x20,
                0xA0, 0xF3, 0x4E, 0x8F, 0xFF, 0xD9,
            ])
            .unwrap();

        let metadata = TrackMetadataUpdate {
            title: "Test Track".to_string(),
            artist: Some("Test Artist".to_string()),
            album: Some("Test Album".to_string()),
            album_artist: None,
            track_number: Some(1),
            disc_number: None,
            year: Some(2024),
            genre: None,
            art_path: Some(art_path.to_string_lossy().into_owned()),
            art_changed: true,
            lyrics: None,
            lyrics_changed: false,
        };

        let backup_config = MetadataBackupConfig {
            enabled: true,
            retention_days: 14,
        };
        write_m4a(&audio, &metadata, &backup_config).expect("write m4a metadata");

        let tag = Mp4Tag::read_from_path(&audio).expect("re-read after write");
        assert_eq!(tag.title().as_deref(), Some("Test Track"));
        assert_eq!(tag.artist().as_deref(), Some("Test Artist"));
        assert!(tag.artwork().is_some());

        let backup = metadata_backup::backup_path_for(&audio);
        assert!(backup.exists(), "backup should be created");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn mp4_artwork_converts_webp_to_jpeg() {
        let dir = std::env::temp_dir().join(format!("spiral-webp-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let webp_path = dir.join("cover.webp");
        let img = image::RgbaImage::from_pixel(2, 2, image::Rgba([10, 20, 30, 255]));
        img.save(&webp_path).expect("write webp");

        let bytes = fs::read(&webp_path).unwrap();
        let artwork = mp4_artwork(
            webp_path.to_str().unwrap(),
            bytes,
        )
        .expect("convert webp");

        assert_eq!(artwork.fmt, mp4ameta::ImgFmt::Jpeg);
        assert!(!artwork.data.is_empty());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn m4a_skips_artwork_when_unchanged() {
        let dir = std::env::temp_dir().join(format!("spiral-meta-test2-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let audio = m4a::copy_moov_before_mdat(&dir, "test.m4a");
        let before_len = fs::metadata(&audio).unwrap().len();

        let metadata = TrackMetadataUpdate {
            title: "Only Title".to_string(),
            artist: None,
            album: None,
            album_artist: None,
            track_number: None,
            disc_number: None,
            year: None,
            genre: None,
            art_path: None,
            art_changed: false,
            lyrics: None,
            lyrics_changed: false,
        };

        let backup_config = MetadataBackupConfig {
            enabled: true,
            retention_days: 14,
        };
        write_m4a(&audio, &metadata, &backup_config).expect("write text-only metadata");
        let tag = Mp4Tag::read_from_path(&audio).expect("re-read");
        assert_eq!(tag.title().as_deref(), Some("Only Title"));
        assert!(tag.artwork().is_none());

        // Text-only update should not balloon the file with cover data.
        let after_len = fs::metadata(&audio).unwrap().len();
        assert!(
            after_len <= before_len + 4096,
            "unexpected size growth: {before_len} -> {after_len}"
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn wav_write_tags_on_file_without_id3() {
        let dir = std::env::temp_dir().join(format!("spiral-wav-notag-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let audio = dir.join("tagless.wav");
        wav::write_minimal(&audio);

        let metadata = TrackMetadataUpdate {
            title: "Tagged Title".to_string(),
            artist: Some("Tagged Artist".to_string()),
            album: Some("Tagged Album".to_string()),
            album_artist: None,
            track_number: Some(1),
            disc_number: None,
            year: Some(2024),
            genre: Some("Rock".to_string()),
            art_path: None,
            art_changed: false,
            lyrics: None,
            lyrics_changed: false,
        };

        let backup_config = MetadataBackupConfig {
            enabled: false,
            retention_days: 14,
        };
        write_wav(&audio, &metadata, &backup_config).expect("write wav metadata");

        let tag = Tag::read_from_path(&audio).expect("re-read after write");
        assert_eq!(tag.title().as_deref(), Some("Tagged Title"));
        assert_eq!(tag.artist().as_deref(), Some("Tagged Artist"));
        assert_eq!(tag.album().as_deref(), Some("Tagged Album"));
        assert_eq!(tag.genre().as_deref(), Some("Rock"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn wav_write_artwork_adds_apic_frame() {
        let dir = std::env::temp_dir().join(format!("spiral-wav-art-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let audio = dir.join("cover.wav");
        wav::write_minimal(&audio);
        let art_path = dir.join("cover.jpg");
        let mut art_file = fs::File::create(&art_path).unwrap();
        art_file
            .write_all(&[
                0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00,
                0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xFF, 0xDB, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06,
                0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0A, 0x0C, 0x14, 0x0D,
                0x0C, 0x0B, 0x0B, 0x0C, 0x19, 0x12, 0x13, 0x0F, 0x14, 0x1D, 0x1A, 0x1F, 0x1E, 0x1D,
                0x1A, 0x1C, 0x1C, 0x20, 0x24, 0x2E, 0x27, 0x20, 0x22, 0x2C, 0x23, 0x1C, 0x1C, 0x28,
                0x37, 0x29, 0x2C, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1F, 0x27, 0x39, 0x3D, 0x38, 0x32,
                0x3C, 0x2E, 0x33, 0x34, 0x32, 0xFF, 0xC0, 0x00, 0x0B, 0x08, 0x00, 0x01, 0x00, 0x01,
                0x01, 0x01, 0x11, 0x00, 0xFF, 0xC4, 0x00, 0x1F, 0x00, 0x00, 0x01, 0x05, 0x01, 0x01,
                0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x02,
                0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x0B, 0xFF, 0xC4, 0x00, 0xB5, 0x10,
                0x00, 0x02, 0x01, 0x03, 0x03, 0x02, 0x04, 0x03, 0x05, 0x05, 0x04, 0x04, 0x00, 0x00,
                0x01, 0x7D, 0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06,
                0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xA1, 0x08, 0x23, 0x42,
                0xB1, 0xC1, 0x15, 0x52, 0xD1, 0xF0, 0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0A, 0x16,
                0x17, 0x18, 0x19, 0x1A, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2A, 0x34, 0x35, 0x36, 0x37,
                0x38, 0x39, 0x3A, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4A, 0x53, 0x54, 0x55,
                0x56, 0x57, 0x58, 0x59, 0x5A, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6A, 0x73,
                0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7A, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
                0x8A, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9A, 0xA2, 0xA3, 0xA4, 0xA5,
                0xA6, 0xA7, 0xA8, 0xA9, 0xAA, 0xB2, 0xB3, 0xB4, 0xB5, 0xB6, 0xB7, 0xB8, 0xB9, 0xBA,
                0xC2, 0xC3, 0xC4, 0xC5, 0xC6, 0xC7, 0xC8, 0xC9, 0xCA, 0xD2, 0xD3, 0xD4, 0xD5, 0xD6,
                0xD7, 0xD8, 0xD9, 0xDA, 0xE1, 0xE2, 0xE3, 0xE4, 0xE5, 0xE6, 0xE7, 0xE8, 0xE9, 0xEA,
                0xF1, 0xF2, 0xF3, 0xF4, 0xF5, 0xF6, 0xF7, 0xF8, 0xF9, 0xFA, 0xFF, 0xDA, 0x00, 0x0C,
                0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3F, 0x00, 0xFB, 0xD5, 0xDB, 0x20,
                0xA0, 0xF3, 0x4E, 0x8F, 0xFF, 0xD9,
            ])
            .unwrap();

        let metadata = TrackMetadataUpdate {
            title: "Art Track".to_string(),
            artist: None,
            album: None,
            album_artist: None,
            track_number: None,
            disc_number: None,
            year: None,
            genre: None,
            art_path: Some(art_path.to_string_lossy().into_owned()),
            art_changed: true,
            lyrics: None,
            lyrics_changed: false,
        };

        let backup_config = MetadataBackupConfig {
            enabled: false,
            retention_days: 14,
        };
        write_wav(&audio, &metadata, &backup_config).expect("write wav art");

        let tag = Tag::read_from_path(&audio).expect("re-read after write");
        assert_eq!(tag.title().as_deref(), Some("Art Track"));
        assert!(tag.pictures().next().is_some());

        let _ = fs::remove_dir_all(&dir);
    }

    fn lyrics_metadata(plain: &str) -> TrackMetadataUpdate {
        TrackMetadataUpdate {
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
            lyrics: Some(crate::lyrics_tags::track_lyrics_input_from_plain(plain)),
            lyrics_changed: true,
        }
    }

    fn clear_lyrics_metadata() -> TrackMetadataUpdate {
        TrackMetadataUpdate {
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
            lyrics: None,
            lyrics_changed: true,
        }
    }

    fn line_synced_lyrics_metadata() -> TrackMetadataUpdate {
        use crate::models::{LyricsFormat, LyricsLine, LyricsSource, TrackLyricsInput};

        TrackMetadataUpdate {
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
                    text: "Synced line".to_string(),
                    start_ms: Some(5_000),
                    end_ms: None,
                    words: None,
                }],
                plain_text: "Synced line".to_string(),
            }),
            lyrics_changed: true,
        }
    }

    #[test]
    fn mp3_write_line_synced_lyrics_round_trip() {
        let dir = std::env::temp_dir().join(format!("spiral-mp3-lrc-write-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let audio = dir.join("lyrics.mp3");
        let mut f = fs::File::create(&audio).unwrap();
        f.write_all(&[0xFF, 0xFB, 0x90, 0x00, 0x00, 0x00, 0x00, 0x00])
            .unwrap();

        let backup_config = MetadataBackupConfig {
            enabled: false,
            retention_days: 14,
        };
        write_mp3(&audio, &line_synced_lyrics_metadata(), &backup_config)
            .expect("write mp3 line-synced lyrics");

        let tag = Tag::read_from_path(&audio).expect("re-read mp3");
        let raw = crate::lyrics_tags::read_lyrics_from_id3(&tag).expect("read mp3 lyrics");
        assert_eq!(raw.hint, crate::lyrics_tags::LyricsFormatHint::LineSynced);
        assert!(raw.text.contains("[00:05.00] Synced line"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn flac_write_line_synced_lyrics_round_trip() {
        let dir =
            std::env::temp_dir().join(format!("spiral-flac-lrc-write-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let audio = copy_minimal_flac_fixture(&dir);
        let backup_config = MetadataBackupConfig {
            enabled: false,
            retention_days: 14,
        };
        write_flac(&audio, &line_synced_lyrics_metadata(), &backup_config)
            .expect("write flac line-synced lyrics");

        let tag = FlacTag::read_from_path(&audio).expect("re-read flac");
        let raw = crate::lyrics_tags::read_lyrics_from_flac(&tag).expect("read flac lyrics");
        assert_eq!(raw.hint, crate::lyrics_tags::LyricsFormatHint::LineSynced);
        assert!(raw.text.contains("[00:05.00] Synced line"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn m4a_write_line_synced_lyrics_strips_timestamps() {
        let dir =
            std::env::temp_dir().join(format!("spiral-m4a-lrc-write-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let audio = m4a::copy_moov_before_mdat(&dir, "lyrics.m4a");
        let backup_config = MetadataBackupConfig {
            enabled: false,
            retention_days: 14,
        };
        write_m4a(&audio, &line_synced_lyrics_metadata(), &backup_config)
            .expect("write m4a line-synced lyrics");

        let tag = Mp4Tag::read_from_path(&audio).expect("re-read m4a");
        let raw = crate::lyrics_tags::read_lyrics_from_mp4(&tag).expect("read m4a lyrics");
        assert_eq!(raw.text, "Synced line");
        assert_eq!(raw.hint, crate::lyrics_tags::LyricsFormatHint::Plain);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn mp3_write_lyrics_round_trip() {
        let dir = std::env::temp_dir().join(format!("spiral-mp3-lyrics-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let audio = dir.join("lyrics.mp3");
        let mut f = fs::File::create(&audio).unwrap();
        f.write_all(&[0xFF, 0xFB, 0x90, 0x00, 0x00, 0x00, 0x00, 0x00])
            .unwrap();

        let backup_config = MetadataBackupConfig {
            enabled: false,
            retention_days: 14,
        };
        write_mp3(
            &audio,
            &lyrics_metadata("Line one\nLine two"),
            &backup_config,
        )
        .expect("write mp3 lyrics");

        let tag = Tag::read_from_path(&audio).expect("re-read mp3");
        let raw = crate::lyrics_tags::read_lyrics_from_id3(&tag).expect("read mp3 lyrics");
        assert_eq!(raw.text, "Line one\nLine two");

        write_mp3(&audio, &clear_lyrics_metadata(), &backup_config).expect("clear mp3 lyrics");
        let tag = Tag::read_from_path(&audio).expect("re-read cleared mp3");
        assert!(crate::lyrics_tags::read_lyrics_from_id3(&tag).is_none());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_lyrics_projection_updates_lyrics_only() {
        let dir = std::env::temp_dir().join(format!(
            "spiral-lyrics-projection-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let audio = dir.join("song.mp3");
        let mut f = fs::File::create(&audio).unwrap();
        f.write_all(&[0xFF, 0xFB, 0x90, 0x00, 0x00, 0x00, 0x00, 0x00])
            .unwrap();

        let backup_config = MetadataBackupConfig {
            enabled: false,
            retention_days: 14,
        };
        write_mp3(
            &audio,
            &TrackMetadataUpdate {
                title: "Keep Title".to_string(),
                artist: Some("Keep Artist".to_string()),
                album: None,
                album_artist: None,
                track_number: None,
                disc_number: None,
                year: None,
                genre: None,
                art_path: None,
                art_changed: false,
                lyrics: Some(crate::lyrics_tags::track_lyrics_input_from_plain("Old")),
                lyrics_changed: true,
            },
            &backup_config,
        )
        .expect("seed mp3");

        let projected = crate::lyrics_tags::track_lyrics_input_from_plain("Library lyrics");
        write_lyrics_projection(&audio, Some(&projected), &backup_config)
            .expect("project lyrics");

        let tag = Tag::read_from_path(&audio).expect("re-read mp3");
        assert_eq!(tag.title().as_deref(), Some("Keep Title"));
        assert_eq!(tag.artist().as_deref(), Some("Keep Artist"));
        let raw = crate::lyrics_tags::read_lyrics_from_id3(&tag).expect("projected lyrics");
        assert_eq!(raw.text, "Library lyrics");

        write_lyrics_projection(&audio, None, &backup_config).expect("clear projected lyrics");
        let tag = Tag::read_from_path(&audio).expect("re-read cleared");
        assert_eq!(tag.title().as_deref(), Some("Keep Title"));
        assert!(crate::lyrics_tags::read_lyrics_from_id3(&tag).is_none());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn flac_write_lyrics_round_trip() {
        let dir = std::env::temp_dir().join(format!("spiral-flac-lyrics-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let audio = copy_minimal_flac_fixture(&dir);
        let backup_config = MetadataBackupConfig {
            enabled: false,
            retention_days: 14,
        };
        write_flac(
            &audio,
            &lyrics_metadata("FLAC lyric body"),
            &backup_config,
        )
        .expect("write flac lyrics");

        let tag = FlacTag::read_from_path(&audio).expect("re-read flac");
        let raw = crate::lyrics_tags::read_lyrics_from_flac(&tag).expect("read flac lyrics");
        assert_eq!(raw.text, "FLAC lyric body");

        write_flac(&audio, &clear_lyrics_metadata(), &backup_config).expect("clear flac lyrics");
        let tag = FlacTag::read_from_path(&audio).expect("re-read cleared flac");
        assert!(crate::lyrics_tags::read_lyrics_from_flac(&tag).is_none());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn m4a_write_lyrics_round_trip() {
        let dir = std::env::temp_dir().join(format!("spiral-m4a-lyrics-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let audio = m4a::copy_moov_before_mdat(&dir, "lyrics.m4a");
        let backup_config = MetadataBackupConfig {
            enabled: false,
            retention_days: 14,
        };
        write_m4a(
            &audio,
            &lyrics_metadata("M4A lyric body"),
            &backup_config,
        )
        .expect("write m4a lyrics");

        let tag = Mp4Tag::read_from_path(&audio).expect("re-read m4a");
        let raw = crate::lyrics_tags::read_lyrics_from_mp4(&tag).expect("read m4a lyrics");
        assert_eq!(raw.text, "M4A lyric body");

        write_m4a(&audio, &clear_lyrics_metadata(), &backup_config).expect("clear m4a lyrics");
        let tag = Mp4Tag::read_from_path(&audio).expect("re-read cleared m4a");
        assert!(crate::lyrics_tags::read_lyrics_from_mp4(&tag).is_none());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn ogg_write_lyrics_round_trip() {
        use crate::test_fixtures::ogg;
        use lofty::file::TaggedFileExt;
        use lofty::probe::Probe;

        let dir = std::env::temp_dir().join(format!("spiral-ogg-lyrics-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let audio = ogg::copy_minimal(&dir, "lyrics.ogg");
        let backup_config = MetadataBackupConfig {
            enabled: false,
            retention_days: 14,
        };
        write_vorbis_container(
            &audio,
            &lyrics_metadata("OGG lyric body"),
            &backup_config,
        )
        .expect("write ogg lyrics");

        let tagged = Probe::open(&audio)
            .expect("open ogg")
            .guess_file_type()
            .expect("guess ogg")
            .read()
            .expect("read ogg");
        let tag = tagged.primary_tag().expect("vorbis tag");
        let raw = crate::lyrics_tags::read_lyrics_from_vorbis(tag).expect("read ogg lyrics");
        assert_eq!(raw.text, "OGG lyric body");

        write_vorbis_container(&audio, &clear_lyrics_metadata(), &backup_config)
            .expect("clear ogg lyrics");
        let tagged = Probe::open(&audio)
            .expect("open cleared ogg")
            .guess_file_type()
            .expect("guess cleared ogg")
            .read()
            .expect("read cleared ogg");
        let tag = tagged.primary_tag().expect("cleared vorbis tag");
        assert!(crate::lyrics_tags::read_lyrics_from_vorbis(tag).is_none());

        let _ = fs::remove_dir_all(&dir);
    }
}
