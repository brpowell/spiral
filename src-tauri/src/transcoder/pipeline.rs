//! Shared convert pipeline: decode -> PCM -> profile encoder -> metadata.

use std::fs;
use std::path::Path;

use crate::encoding_profiles;
use crate::metadata_backup::MetadataBackupConfig;
use crate::metadata_writer;
use crate::models::TrackMetadataUpdate;

use super::aac;
use super::alac;
use super::decode;
use super::flac;
use super::lame;
use super::pcm_stream::PcmStream;

pub fn transcode_file_with_metadata(
    source: &Path,
    dest: &Path,
    profile_id: &str,
    metadata: &TrackMetadataUpdate,
    backup_config: &MetadataBackupConfig,
) -> Result<(), String> {
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("Failed to create output folder: {err}"))?;
    }

    // Resolve profile before decode so unknown profiles fail fast.
    let _ = encoding_profiles::profile_from_id(profile_id)?;

    let pcm = decode::pcm_from_audio_file(source)?;
    encode_pcm_to_profile(&pcm, dest, profile_id)?;

    metadata_writer::write_track_metadata(dest, metadata, backup_config)
        .map_err(|err| err.to_message())
}

pub(crate) fn encode_pcm_to_profile(
    pcm: &PcmStream,
    dest: &Path,
    profile_id: &str,
) -> Result<(), String> {
    let profile = encoding_profiles::profile_from_id(profile_id)?;
    if encoding_profiles::profile_is_alac(profile.id) {
        return alac::encode_pcm_to_alac_m4a(pcm, dest);
    }
    if encoding_profiles::profile_is_mp3(profile.id) {
        return lame::encode_pcm_to_mp3(pcm, dest, profile);
    }
    if encoding_profiles::profile_is_flac(profile.id) {
        return flac::encode_pcm_to_flac(pcm, dest);
    }
    match profile.id {
        "apple-aac" => aac::encode_pcm_to_aac_m4a(pcm, dest, profile),
        other => Err(format!("Unknown encoding profile: {other}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::metadata_reader;
    use std::io::Write;
    use std::path::PathBuf;

    fn silence_pcm() -> PcmStream {
        PcmStream {
            channels: 2,
            sample_rate: 44_100,
            // One ALAC packet / several MP3 frames keeps encode cheap.
            samples: vec![0; 4096 * 2],
        }
    }

    fn minimal_flac_fixture() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/minimal.flac")
    }

    fn sample_metadata() -> TrackMetadataUpdate {
        TrackMetadataUpdate {
            title: "Converted Song".to_string(),
            artist: Some("Converted Artist".to_string()),
            album: Some("Converted Album".to_string()),
            album_artist: None,
            track_number: Some(3),
            total_tracks: None,
            disc_number: None,
            total_discs: None,
            year: Some(2024),
            genre: None,
            art_path: None,
            art_changed: false,
            lyrics: None,
            lyrics_changed: false,
        }
    }

    fn metadata_with_cover(art_path: &Path) -> TrackMetadataUpdate {
        let mut metadata = sample_metadata();
        metadata.art_path = Some(art_path.to_string_lossy().into_owned());
        metadata.art_changed = true;
        metadata
    }

    fn write_minimal_jpeg(path: &Path) {
        let mut file = fs::File::create(path).unwrap();
        file.write_all(&[
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
    }

    fn disabled_backup() -> MetadataBackupConfig {
        MetadataBackupConfig {
            enabled: false,
            retention_days: 14,
        }
    }

    #[test]
    fn encode_pcm_to_profile_routes_alac() {
        let dest = std::env::temp_dir().join(format!(
            "spiral-pipeline-alac-{}.m4a",
            std::process::id()
        ));
        let _ = fs::remove_file(&dest);

        encode_pcm_to_profile(&silence_pcm(), &dest, "apple-alac").expect("alac encode");
        assert!(dest.is_file());
        assert!(dest.metadata().unwrap().len() > 64);

        let _ = fs::remove_file(&dest);
    }

    #[test]
    fn encode_pcm_to_profile_routes_mp3_profiles() {
        for profile_id in ["mp3-high", "mp3-compact"] {
            let dest = std::env::temp_dir().join(format!(
                "spiral-pipeline-{profile_id}-{}.mp3",
                std::process::id()
            ));
            let _ = fs::remove_file(&dest);

            encode_pcm_to_profile(&silence_pcm(), &dest, profile_id).expect("mp3 encode");
            assert!(dest.is_file(), "{profile_id} output missing");
            assert!(
                dest.metadata().unwrap().len() > 64,
                "{profile_id} output too small"
            );

            let _ = fs::remove_file(&dest);
        }
    }

    #[test]
    fn encode_pcm_to_profile_routes_flac() {
        let dest = std::env::temp_dir().join(format!(
            "spiral-pipeline-flac-{}.flac",
            std::process::id()
        ));
        let _ = fs::remove_file(&dest);

        encode_pcm_to_profile(&silence_pcm(), &dest, "lossless-flac").expect("flac encode");
        assert!(dest.is_file());
        let bytes = fs::read(&dest).expect("read flac");
        assert!(bytes.len() > 4);
        assert_eq!(&bytes[..4], b"fLaC");

        let _ = fs::remove_file(&dest);
    }

    #[test]
    fn encode_pcm_to_profile_routes_aac() {
        let dest = std::env::temp_dir().join(format!(
            "spiral-pipeline-aac-{}.m4a",
            std::process::id()
        ));
        let _ = fs::remove_file(&dest);

        encode_pcm_to_profile(&silence_pcm(), &dest, "apple-aac").expect("aac encode");
        assert!(dest.is_file());
        assert!(dest.metadata().unwrap().len() > 64);

        let decoded = decode::pcm_from_audio_file(&dest).expect("decode aac");
        assert_eq!(decoded.channels, 2);
        assert_eq!(decoded.sample_rate, 44_100);

        let _ = fs::remove_file(&dest);
    }

    #[test]
    fn encode_pcm_to_profile_rejects_unknown_id() {
        let err = encode_pcm_to_profile(
            &silence_pcm(),
            Path::new("out.mp3"),
            "unknown",
        )
        .unwrap_err();
        assert!(err.contains("Unknown encoding profile"));
    }

    #[test]
    fn transcode_file_with_metadata_rejects_unknown_profile() {
        let err = transcode_file_with_metadata(
            Path::new("/in.flac"),
            Path::new("/out.mp3"),
            "unknown",
            &sample_metadata(),
            &disabled_backup(),
        )
        .unwrap_err();
        assert!(err.contains("Unknown encoding profile"));
    }

    #[test]
    fn flac_fixture_converts_to_mp3_with_metadata() {
        let source = minimal_flac_fixture();
        if !source.is_file() {
            return;
        }

        let dir = std::env::temp_dir().join(format!(
            "spiral-mp3-flac-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        for profile_id in ["mp3-high", "mp3-compact"] {
            let dest = dir.join(format!("{profile_id}.mp3"));
            transcode_file_with_metadata(
                &source,
                &dest,
                profile_id,
                &sample_metadata(),
                &disabled_backup(),
            )
            .unwrap_or_else(|err| panic!("{profile_id} convert failed: {err}"));

            assert!(dest.is_file());
            assert!(dest.metadata().unwrap().len() > 64);

            let tags = metadata_reader::read_basic_tags(&dest);
            assert_eq!(tags.title.as_deref(), Some("Converted Song"));
            assert_eq!(tags.artist.as_deref(), Some("Converted Artist"));
            assert_eq!(tags.album.as_deref(), Some("Converted Album"));
            assert_eq!(tags.track_number, Some(3));
            assert_eq!(tags.year, Some(2024));
        }

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn flac_fixture_converts_to_aac_with_metadata_and_cover() {
        let source = minimal_flac_fixture();
        if !source.is_file() {
            return;
        }

        let dir = std::env::temp_dir().join(format!(
            "spiral-aac-flac-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let art_path = dir.join("cover.jpg");
        write_minimal_jpeg(&art_path);

        let dest = dir.join("out.m4a");
        transcode_file_with_metadata(
            &source,
            &dest,
            "apple-aac",
            &metadata_with_cover(&art_path),
            &disabled_backup(),
        )
        .expect("flac to apple-aac");

        assert!(dest.is_file());
        assert!(dest.metadata().unwrap().len() > 64);

        let tags = metadata_reader::read_basic_tags(&dest);
        assert_eq!(tags.title.as_deref(), Some("Converted Song"));
        assert_eq!(tags.artist.as_deref(), Some("Converted Artist"));
        assert_eq!(tags.album.as_deref(), Some("Converted Album"));
        assert_eq!(tags.track_number, Some(3));
        assert_eq!(tags.year, Some(2024));

        let tag = mp4ameta::Tag::read_from_path(&dest).expect("read m4a tags");
        assert!(tag.artwork().is_some(), "cover art should be written");

        let decoded = decode::pcm_from_audio_file(&dest).expect("decode converted aac");
        assert!(decoded.channels >= 1);
        assert!(decoded.sample_rate > 0);

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn mp3_converts_to_aac_with_metadata() {
        let dir = std::env::temp_dir().join(format!(
            "spiral-aac-from-mp3-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let source = dir.join("source.mp3");
        let pcm = PcmStream {
            channels: 2,
            sample_rate: 44_100,
            samples: (0..44_100 * 2 / 5)
                .map(|i| ((i % 64) as i16).wrapping_mul(17))
                .collect(),
        };
        lame::encode_pcm_to_mp3(
            &pcm,
            &source,
            encoding_profiles::profile_from_id("mp3-high").unwrap(),
        )
        .expect("write mp3 source");

        let dest = dir.join("out.m4a");
        transcode_file_with_metadata(
            &source,
            &dest,
            "apple-aac",
            &sample_metadata(),
            &disabled_backup(),
        )
        .expect("mp3 to apple-aac");

        assert!(dest.is_file());
        let tags = metadata_reader::read_basic_tags(&dest);
        assert_eq!(tags.title.as_deref(), Some("Converted Song"));
        assert_eq!(tags.artist.as_deref(), Some("Converted Artist"));

        let decoded = decode::pcm_from_audio_file(&dest).expect("decode aac from mp3");
        assert_eq!(decoded.channels, 2);
        assert_eq!(decoded.sample_rate, 44_100);

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn wav_fixture_converts_to_mp3_high() {
        let dir = std::env::temp_dir().join(format!(
            "spiral-mp3-wav-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let source = dir.join("source.wav");
        let pcm = PcmStream {
            channels: 2,
            sample_rate: 44_100,
            samples: vec![0; 44_100 * 2 / 10], // ~100ms stereo
        };
        super::super::wav::write_pcm_to_wav(&pcm, &source).expect("write wav source");

        let dest = dir.join("out.mp3");
        transcode_file_with_metadata(
            &source,
            &dest,
            "mp3-high",
            &sample_metadata(),
            &disabled_backup(),
        )
        .expect("wav to mp3-high");

        assert!(dest.is_file());
        let tags = metadata_reader::read_basic_tags(&dest);
        assert_eq!(tags.title.as_deref(), Some("Converted Song"));

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn wav_fixture_converts_to_lossless_flac_with_metadata() {
        let dir = std::env::temp_dir().join(format!(
            "spiral-flac-wav-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let source = dir.join("source.wav");
        let pcm = PcmStream {
            channels: 2,
            sample_rate: 44_100,
            samples: (0..44_100 * 2 / 10)
                .map(|i| ((i % 64) as i16).wrapping_mul(17))
                .collect(),
        };
        super::super::wav::write_pcm_to_wav(&pcm, &source).expect("write wav source");

        let dest = dir.join("out.flac");
        transcode_file_with_metadata(
            &source,
            &dest,
            "lossless-flac",
            &sample_metadata(),
            &disabled_backup(),
        )
        .expect("wav to lossless-flac");

        assert!(dest.is_file());
        assert!(dest.metadata().unwrap().len() > 64);

        let tags = metadata_reader::read_basic_tags(&dest);
        assert_eq!(tags.title.as_deref(), Some("Converted Song"));
        assert_eq!(tags.artist.as_deref(), Some("Converted Artist"));
        assert_eq!(tags.album.as_deref(), Some("Converted Album"));
        assert_eq!(tags.track_number, Some(3));
        assert_eq!(tags.year, Some(2024));

        let decoded = decode::pcm_from_audio_file(&dest).expect("decode converted flac");
        assert_eq!(decoded.channels, pcm.channels);
        assert_eq!(decoded.sample_rate, pcm.sample_rate);
        assert_eq!(decoded.samples, pcm.samples);

        let _ = fs::remove_dir_all(dir);
    }
}

