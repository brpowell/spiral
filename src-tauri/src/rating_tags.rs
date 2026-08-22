use crate::metadata_backup::MetadataBackupConfig;
use crate::metadata_writer::{self, MetadataWriteError};
use id3::frame::Popularimeter;
use id3::{ErrorKind, Tag, TagLike, Version};
use metaflac::Tag as FlacTag;
use mp4ameta::ident::{FreeformIdent, FreeformIdentStatic, APPLE_ITUNES_MEAN};
use mp4ameta::{Data, Tag as Mp4Tag};
use std::path::Path;

/// Vorbis `RATING` and iTunes freeform `rating` strings use ambiguous scales.
///
/// Import heuristic (common tag conventions, not Spiral UI glyphs):
/// - value ≤ 5 → treat as 0–5 point scale: `round(value / 5 * 255)`
/// - else → treat as 0–100 percent: `round(value / 100 * 255)`
///
/// Malformed or out-of-range values return `None` (unrated).

const POPM_USER: &str = "Spiral";

const ITUNES_RATING: FreeformIdentStatic = FreeformIdent::new_static(APPLE_ITUNES_MEAN, "rating");

/// POPM stores canonical 0–255 directly (0 = unrated / unknown in ID3).
pub fn canonical_to_popm(canonical: u8) -> u8 {
    canonical
}

/// Vorbis comment `RATING` and iTunes freeform `rating` use 0–100 percent.
pub fn canonical_to_percent(canonical: u8) -> u8 {
    ((f64::from(canonical) / 255.0) * 100.0).round() as u8
}

/// ID3 POPM rating byte is canonical 0–255; `0` means unrated.
pub fn popm_to_canonical(popm: u8) -> Option<u8> {
    if popm == 0 {
        None
    } else {
        Some(popm)
    }
}

pub fn percent_to_canonical(value: f64) -> Option<u8> {
    if value <= 0.0 {
        return None;
    }
    let canonical = if value <= 5.0 {
        (value / 5.0 * 255.0).round() as i32
    } else if value <= 100.0 {
        (value / 100.0 * 255.0).round() as i32
    } else {
        return None;
    };
    (1..=255).contains(&canonical).then_some(canonical as u8)
}

pub fn parse_rating_string(value: &str) -> Option<u8> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }
    let parsed: f64 = trimmed.parse().ok()?;
    percent_to_canonical(parsed)
}

pub fn read_mp3_rating(tag: &Tag) -> Option<u8> {
    tag.frames()
        .find_map(|frame| frame.content().popularimeter())
        .and_then(|popm| popm_to_canonical(popm.rating))
}

pub fn read_flac_rating(tag: &FlacTag) -> Option<u8> {
    tag.get_vorbis("RATING")
        .and_then(|mut values| values.next())
        .and_then(|value| parse_rating_string(value))
}

pub fn read_vorbis_rating(tag: &lofty::tag::Tag) -> Option<u8> {
    tag.get(&rating_item_key())
        .and_then(|item| item.value().text())
        .and_then(parse_rating_string)
}

fn rating_item_key() -> lofty::tag::ItemKey {
    lofty::tag::ItemKey::Unknown("RATING".to_string())
}

pub fn read_m4a_rating(tag: &Mp4Tag) -> Option<u8> {
    tag.data_of(&ITUNES_RATING)
        .next()
        .and_then(|data| data.string())
        .and_then(parse_rating_string)
}

pub fn write_rating_to_file(
    path: &Path,
    canonical: u8,
    backup_config: &MetadataBackupConfig,
) -> Result<(), MetadataWriteError> {
    metadata_writer::ensure_writable(path)?;

    match metadata_writer::audio_extension(path).as_deref() {
        Some("mp3") => write_mp3_rating(path, canonical, backup_config),
        Some("flac") => write_flac_rating(path, canonical, backup_config),
        Some("m4a") | Some("aac") | Some("mp4") => write_m4a_rating(path, canonical, backup_config),
        Some("wav") => write_wav_rating(path, canonical, backup_config),
        Some("ogg") | Some("opus") => write_vorbis_container_rating(path, canonical, backup_config),
        Some(ext) => Err(MetadataWriteError::UnsupportedFormat(format!(
            "Rating export is not supported for .{ext} files."
        ))),
        None => Err(MetadataWriteError::UnsupportedFormat(
            "Unknown audio format.".to_string(),
        )),
    }
}

fn apply_popm_to_tag(tag: &mut Tag, canonical: u8) {
    tag.remove("POPM");
    if canonical > 0 {
        tag.add_frame(Popularimeter {
            user: POPM_USER.to_string(),
            rating: canonical_to_popm(canonical),
            counter: 0,
        });
    }
}

fn write_mp3_rating(
    path: &Path,
    canonical: u8,
    backup_config: &MetadataBackupConfig,
) -> Result<(), MetadataWriteError> {
    metadata_writer::write_via_temp(path, backup_config, |target| {
        let mut tag = metadata_writer::read_id3_tag(target)?;
        apply_popm_to_tag(&mut tag, canonical);
        tag.write_to_path(target, Version::Id3v24)
            .map_err(|e| MetadataWriteError::Tag(format!("Failed to write MP3 rating: {e}")))?;
        Ok(())
    })
}

fn write_flac_rating(
    path: &Path,
    canonical: u8,
    backup_config: &MetadataBackupConfig,
) -> Result<(), MetadataWriteError> {
    metadata_writer::write_via_temp(path, backup_config, |target| {
        let mut tag = FlacTag::read_from_path(target)
            .map_err(|e| MetadataWriteError::Tag(format!("Failed to read FLAC tags: {e}")))?;

        if canonical == 0 {
            tag.remove_vorbis("RATING");
        } else {
            tag.set_vorbis("RATING", vec![canonical_to_percent(canonical).to_string()]);
        }

        tag.save()
            .map_err(|e| MetadataWriteError::Tag(format!("Failed to write FLAC rating: {e}")))?;
        Ok(())
    })
}

fn write_vorbis_container_rating(
    path: &Path,
    canonical: u8,
    backup_config: &MetadataBackupConfig,
) -> Result<(), MetadataWriteError> {
    metadata_writer::write_via_temp(path, backup_config, |target| {
        crate::vorbis_container::write_vorbis_container_rating(target, canonical)
    })
}

fn write_m4a_rating_tag(target: &Path, canonical: u8) -> Result<(), MetadataWriteError> {
    let mut tag = Mp4Tag::read_from_path(target)
        .map_err(|e| MetadataWriteError::Tag(format!("Failed to read M4A tags: {e}")))?;

    if canonical == 0 {
        tag.remove_data_of(&ITUNES_RATING);
    } else {
        tag.set_data(
            ITUNES_RATING,
            Data::Utf8(canonical_to_percent(canonical).to_string()),
        );
    }

    tag.write_to_path(target)
        .map_err(|e| MetadataWriteError::Tag(format!("Failed to write M4A rating: {e}")))?;
    metadata_writer::verify_m4a_readable(target)?;
    Ok(())
}

fn write_m4a_rating(
    path: &Path,
    canonical: u8,
    backup_config: &MetadataBackupConfig,
) -> Result<(), MetadataWriteError> {
    metadata_writer::write_via_temp(path, backup_config, |target| {
        write_m4a_rating_tag(target, canonical)
    })
}

fn write_wav_rating(
    path: &Path,
    canonical: u8,
    backup_config: &MetadataBackupConfig,
) -> Result<(), MetadataWriteError> {
    match Tag::read_from_path(path) {
        Err(id3::Error {
            kind: ErrorKind::NoTag,
            ..
        }) => Ok(()),
        Err(e) => Err(MetadataWriteError::Tag(format!(
            "Failed to read WAV ID3 tags: {e}"
        ))),
        Ok(_) => metadata_writer::write_via_temp(path, backup_config, |target| {
            let mut tag = Tag::read_from_path(target).map_err(|e| {
                MetadataWriteError::Tag(format!("Failed to read WAV ID3 tags: {e}"))
            })?;
            apply_popm_to_tag(&mut tag, canonical);
            tag.write_to_path(target, Version::Id3v24)
                .map_err(|e| MetadataWriteError::Tag(format!("Failed to write WAV rating: {e}")))?;
            Ok(())
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_fixtures::m4a;
    use std::fs;
    use std::io::Write;

    #[test]
    fn canonical_to_popm_is_identity() {
        assert_eq!(canonical_to_popm(0), 0);
        assert_eq!(canonical_to_popm(128), 128);
        assert_eq!(canonical_to_popm(255), 255);
    }

    #[test]
    fn canonical_to_percent_rounds() {
        assert_eq!(canonical_to_percent(0), 0);
        assert_eq!(canonical_to_percent(128), 50);
        assert_eq!(canonical_to_percent(255), 100);
    }

    #[test]
    fn popm_to_canonical_clamps_unrated() {
        assert_eq!(popm_to_canonical(0), None);
        assert_eq!(popm_to_canonical(204), Some(204));
    }

    #[test]
    fn percent_to_canonical_uses_five_point_heuristic() {
        assert_eq!(percent_to_canonical(0.0), None);
        assert_eq!(percent_to_canonical(5.0), Some(255));
        assert_eq!(percent_to_canonical(2.5), Some(128));
    }

    #[test]
    fn percent_to_canonical_uses_percent_scale_above_five() {
        assert_eq!(percent_to_canonical(50.0), Some(128));
        assert_eq!(percent_to_canonical(100.0), Some(255));
    }

    #[test]
    fn parse_rating_string_rejects_malformed() {
        assert_eq!(parse_rating_string(""), None);
        assert_eq!(parse_rating_string("not-a-number"), None);
        assert_eq!(parse_rating_string("150"), None);
    }

    #[test]
    fn mp4_write_rating_uses_m4a_path() {
        let dir = std::env::temp_dir().join(format!("spiral-mp4-rating-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let audio = m4a::copy_moov_before_mdat(&dir, "rated.mp4");

        let backup_config = MetadataBackupConfig {
            enabled: false,
            retention_days: 14,
        };
        write_rating_to_file(&audio, 204, &backup_config).expect("write mp4 rating");

        let tag = Mp4Tag::read_from_path(&audio).expect("re-read");
        assert_eq!(read_m4a_rating(&tag), Some(204));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn mp3_write_popm_matches_canonical() {
        let dir = std::env::temp_dir().join(format!("spiral-rating-mp3-{}", std::process::id()));
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
        write_mp3_rating(&audio, 204, &backup_config).expect("write mp3 rating");

        let tag = Tag::read_from_path(&audio).expect("re-read");
        let popm = tag
            .frames()
            .find_map(|frame| frame.content().popularimeter())
            .expect("POPM frame");
        assert_eq!(popm.rating, 204);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn mp3_clear_rating_removes_popm() {
        let dir = std::env::temp_dir().join(format!("spiral-rating-clear-{}", std::process::id()));
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
        write_mp3_rating(&audio, 128, &backup_config).unwrap();
        write_mp3_rating(&audio, 0, &backup_config).unwrap();

        let tag = Tag::read_from_path(&audio).expect("re-read");
        assert!(tag
            .frames()
            .all(|frame| frame.content().popularimeter().is_none()));

        let _ = fs::remove_dir_all(&dir);
    }
}
