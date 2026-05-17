use crate::models::TrackMetadataUpdate;
use id3::frame::{Picture, PictureType};
use id3::{Tag, TagLike};
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

fn ensure_writable(path: &Path) -> Result<(), MetadataWriteError> {
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

fn audio_extension(path: &Path) -> Option<String> {
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

fn apply_common_mp4(tag: &mut Mp4Tag, metadata: &TrackMetadataUpdate) {
    tag.set_title(metadata.title.clone());
    if let Some(artist) = &metadata.artist {
        tag.set_artist(artist.clone());
    }
    if let Some(album) = &metadata.album {
        tag.set_album(album.clone());
    }
    if let Some(album_artist) = &metadata.album_artist {
        tag.set_album_artist(album_artist.clone());
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

fn backup_path_for(path: &Path) -> PathBuf {
    path.with_extension(format!(
        "{}.bak",
        path.extension()
            .and_then(|e| e.to_str())
            .unwrap_or("audio")
    ))
}

/// Write to a temp copy, verify, then atomically replace the original (keeping a `.bak`).
fn write_via_temp<F>(path: &Path, write: F) -> Result<(), MetadataWriteError>
where
    F: FnOnce(&Path) -> Result<(), MetadataWriteError>,
{
    let temp = temp_path_for(path);
    let backup = backup_path_for(path);

    if temp.exists() {
        std::fs::remove_file(&temp)
            .map_err(|e| MetadataWriteError::Io(format!("Failed to reset temp file: {e}")))?;
    }

    std::fs::copy(path, &temp)
        .map_err(|e| MetadataWriteError::Io(format!("Failed to copy file for safe write: {e}")))?;

    write(&temp)?;

    if backup.exists() {
        std::fs::remove_file(&backup)
            .map_err(|e| MetadataWriteError::Io(format!("Failed to remove old backup: {e}")))?;
    }
    std::fs::copy(path, &backup).map_err(|e| {
        MetadataWriteError::Io(format!("Failed to create backup {}: {e}", backup.display()))
    })?;

    std::fs::rename(&temp, path).map_err(|e| {
        MetadataWriteError::Io(format!("Failed to replace audio file: {e}"))
    })?;

    Ok(())
}

fn verify_m4a_readable(path: &Path) -> Result<(), MetadataWriteError> {
    Mp4Tag::read_from_path(path).map_err(|e| {
        MetadataWriteError::Tag(format!("Written file failed verification read: {e}"))
    })?;
    Ok(())
}

fn write_mp3(path: &Path, metadata: &TrackMetadataUpdate) -> Result<(), MetadataWriteError> {
    write_via_temp(path, |target| {
        let mut tag = Tag::read_from_path(target)
            .map_err(|e| MetadataWriteError::Tag(format!("Failed to read MP3 tags: {e}")))?;

        tag.set_title(metadata.title.clone());
        if let Some(artist) = &metadata.artist {
            tag.set_artist(artist.clone());
        }
        if let Some(album) = &metadata.album {
            tag.set_album(album.clone());
        }
        if let Some(album_artist) = &metadata.album_artist {
            tag.set_text("TPE2", album_artist);
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

        tag.write_to_path(target, id3::Version::Id3v24)
            .map_err(|e| MetadataWriteError::Tag(format!("Failed to write MP3 tags: {e}")))?;
        Ok(())
    })
}

fn write_flac(path: &Path, metadata: &TrackMetadataUpdate) -> Result<(), MetadataWriteError> {
    write_via_temp(path, |target| {
        let mut tag = FlacTag::read_from_path(target)
            .map_err(|e| MetadataWriteError::Tag(format!("Failed to read FLAC tags: {e}")))?;

        tag.set_vorbis("TITLE", vec![metadata.title.clone()]);
        if let Some(artist) = &metadata.artist {
            tag.set_vorbis("ARTIST", vec![artist.clone()]);
        }
        if let Some(album) = &metadata.album {
            tag.set_vorbis("ALBUM", vec![album.clone()]);
        }
        if let Some(album_artist) = &metadata.album_artist {
            tag.set_vorbis("ALBUMARTIST", vec![album_artist.clone()]);
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

    tag.write_to_path(target)
        .map_err(|e| MetadataWriteError::Tag(format!("Failed to write M4A tags: {e}")))?;
    verify_m4a_readable(target)?;
    Ok(())
}

fn write_m4a(path: &Path, metadata: &TrackMetadataUpdate) -> Result<(), MetadataWriteError> {
    write_via_temp(path, |target| write_m4a_tag(target, metadata))
}

pub fn write_track_metadata(
    path: &Path,
    metadata: &TrackMetadataUpdate,
) -> Result<(), MetadataWriteError> {
    ensure_writable(path)?;

    match audio_extension(path).as_deref() {
        Some("mp3") => write_mp3(path, metadata),
        Some("flac") => write_flac(path, metadata),
        Some("m4a") | Some("aac") => write_m4a(path, metadata),
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
    use std::fs;
    use std::io::Write;

    /// iTunes-like layout: `moov` before `mdat` (from `tests/fixtures/moov_before_mdat.m4a`).
    fn copy_moov_before_mdat_fixture(dir: &Path) -> PathBuf {
        let src = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/moov_before_mdat.m4a");
        let dest = dir.join("test.m4a");
        fs::copy(&src, &dest).expect("copy m4a fixture");
        dest
    }

    #[test]
    fn m4a_write_artwork_preserves_playable_structure() {
        let dir = std::env::temp_dir().join(format!("spiral-meta-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let audio = copy_moov_before_mdat_fixture(&dir);
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
        };

        write_m4a(&audio, &metadata).expect("write m4a metadata");

        let tag = Mp4Tag::read_from_path(&audio).expect("re-read after write");
        assert_eq!(tag.title().as_deref(), Some("Test Track"));
        assert_eq!(tag.artist().as_deref(), Some("Test Artist"));
        assert!(tag.artwork().is_some());

        let backup = backup_path_for(&audio);
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

        let audio = copy_moov_before_mdat_fixture(&dir);
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
        };

        write_m4a(&audio, &metadata).expect("write text-only metadata");
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
}
