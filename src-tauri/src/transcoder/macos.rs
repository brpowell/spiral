use std::fs;
use std::path::{Path, PathBuf};

use crate::encoding_profiles::{self, EncodingProfile};
use crate::metadata_backup::MetadataBackupConfig;
use crate::metadata_writer;
use crate::models::TrackMetadataUpdate;

use super::afconvert;
use super::alac;
use super::lame;
use super::wav;

struct TempDecodeWav(PathBuf);

impl Drop for TempDecodeWav {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

fn transcode_file(source: &Path, dest: &Path, profile_id: &str) -> Result<(), String> {
    let profile = encoding_profiles::profile_from_id(profile_id)?;
    if encoding_profiles::profile_is_mp3(profile.id) {
        transcode_to_mp3(source, dest, profile)
    } else if encoding_profiles::profile_is_alac(profile.id) {
        alac::transcode_file_to_alac(source, dest)
    } else {
        afconvert::run(source, dest, &encoding_profiles::afconvert_args(profile))
    }
}

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

    transcode_file(source, dest, profile_id)?;

    metadata_writer::write_track_metadata(dest, metadata, backup_config)
        .map_err(|err| err.to_message())
}

fn transcode_to_mp3(
    source: &Path,
    dest: &Path,
    profile: &EncodingProfile,
) -> Result<(), String> {
    let temp_wav = decode_temp_wav_path(source)?;
    if let Some(parent) = temp_wav.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("Failed to create transcode temp folder: {err}"))?;
    }
    let temp = TempDecodeWav(temp_wav);

    afconvert::decode_to_wav(source, &temp.0)?;
    let pcm = wav::read_pcm_from_wav(&temp.0)?;
    lame::encode_pcm_to_mp3(&pcm, dest, profile)
}

fn decode_temp_wav_path(source: &Path) -> Result<PathBuf, String> {
    let stem = source
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("source");
    Ok(std::env::temp_dir()
        .join("spiral-transcode")
        .join(format!("{stem}-{}.wav", std::process::id())))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn afconvert_command_args(source: &str, dest: &str, profile_id: &str) -> Vec<String> {
        let profile = encoding_profiles::profile_from_id(profile_id).unwrap();
        let mut args = vec!["afconvert".to_string(), source.to_string(), dest.to_string()];
        args.extend(
            encoding_profiles::afconvert_args(profile)
                .into_iter()
                .map(str::to_string),
        );
        args
    }

    #[test]
    fn afconvert_command_includes_profile_args() {
        assert_eq!(
            afconvert_command_args("/in.flac", "/out.m4a", "apple-aac"),
            vec![
                "afconvert",
                "/in.flac",
                "/out.m4a",
                "-f",
                "m4af",
                "-d",
                "aac",
                "-b",
                "256000",
                "-q",
                "127",
                "-s",
                "2",
            ]
        );
    }

    #[test]
    fn transcode_file_rejects_unknown_profile() {
        let err = transcode_file(
            Path::new("/in.flac"),
            Path::new("/out.mp3"),
            "unknown",
        )
        .unwrap_err();
        assert!(err.contains("Unknown encoding profile"));
    }

    #[test]
    fn transcode_file_with_metadata_rejects_unknown_profile() {
        let metadata = TrackMetadataUpdate {
            title: "Song".to_string(),
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
        let backup = MetadataBackupConfig {
            enabled: false,
            retention_days: 14,
        };
        let err = transcode_file_with_metadata(
            Path::new("/in.flac"),
            Path::new("/out.mp3"),
            "unknown",
            &metadata,
            &backup,
        )
        .unwrap_err();
        assert!(err.contains("Unknown encoding profile"));
    }
}
