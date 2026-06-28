//! Built-in encoding profiles shared by CD rip and library convert.

use std::path::{Path, PathBuf};

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EncodingProfile {
    pub id: &'static str,
    pub label: &'static str,
    pub subtitle: &'static str,
    pub extension: &'static str,
}

const PROFILES: &[EncodingProfile] = &[
    EncodingProfile {
        id: "lossless-flac",
        label: "Lossless (FLAC)",
        subtitle: "Best quality for your library",
        extension: "flac",
    },
    EncodingProfile {
        id: "apple-aac",
        label: "Apple Device (AAC)",
        subtitle: ".m4a for iPod, iPhone, and iTunes",
        extension: "m4a",
    },
    EncodingProfile {
        id: "mp3-high",
        label: "MP3 - High (320)",
        subtitle: "Works on almost any player",
        extension: "mp3",
    },
    EncodingProfile {
        id: "mp3-compact",
        label: "MP3 - Compact (128)",
        subtitle: "Smaller files, more songs per device",
        extension: "mp3",
    },
];

pub const DEFAULT_CD_IMPORT_PROFILE_ID: &str = "lossless-flac";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvertProfileOptions {
    pub profile_ids: Vec<String>,
    pub default_profile_id: String,
}

pub fn profile_from_id(id: &str) -> Result<&'static EncodingProfile, String> {
    PROFILES
        .iter()
        .find(|profile| profile.id == id)
        .ok_or_else(|| format!("Unknown encoding profile: {id}"))
}

/// Returns the built-in profile ID that best matches an on-disk file, if any.
pub fn infer_profile_id_from_file(path: &Path) -> Option<&'static str> {
    let ext = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())?;

    match ext.as_str() {
        "flac" => Some("lossless-flac"),
        "m4a" => match read_source_codec(path) {
            Some("alac") => None,
            Some("aac") => Some("apple-aac"),
            _ => None,
        },
        "mp3" => infer_mp3_profile_id(path),
        _ => None,
    }
}

pub fn source_matches_profile(path: &Path, profile_id: &str) -> bool {
    infer_profile_id_from_file(path) == Some(profile_id)
}

pub fn profile_is_lossless(profile_id: &str) -> bool {
    profile_id == "lossless-flac"
}

pub(crate) fn profile_is_mp3(profile_id: &str) -> bool {
    matches!(profile_id, "mp3-high" | "mp3-compact")
}

pub fn source_is_lossless(path: &Path) -> bool {
    if path
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("flac"))
    {
        return true;
    }

    path.extension()
        .and_then(|value| value.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("m4a"))
        && read_source_codec(path) == Some("alac")
}

pub fn can_convert_to_profile(path: &Path, profile_id: &str) -> bool {
    if source_matches_profile(path, profile_id) {
        return false;
    }
    !(profile_is_lossless(profile_id) && !source_is_lossless(path))
}

pub fn convert_profile_options_for_sources(
    source_paths: &[PathBuf],
) -> Result<ConvertProfileOptions, String> {
    if source_paths.is_empty() {
        return Err("No source files provided".into());
    }

    for path in source_paths {
        if !path.is_file() {
            return Err(format!("Source file not found: {}", path.display()));
        }
    }

    let profile_ids: Vec<String> = PROFILES
        .iter()
        .filter(|profile| {
            source_paths
                .iter()
                .all(|path| can_convert_to_profile(path, profile.id))
        })
        .map(|profile| profile.id.to_string())
        .collect();

    if profile_ids.is_empty() {
        return Err("No encoding profiles are available for the selected tracks".into());
    }

    let default_profile_id = infer_default_convert_profile_id(&source_paths[0], &profile_ids)
        .ok_or_else(|| "No default encoding profile available".to_string())?;

    Ok(ConvertProfileOptions {
        profile_ids,
        default_profile_id,
    })
}

fn infer_default_convert_profile_id(
    source_path: &Path,
    allowed_profile_ids: &[String],
) -> Option<String> {
    let current = infer_profile_id_from_file(source_path);
    allowed_profile_ids
        .iter()
        .find(|id| Some(id.as_str()) != current)
        .or_else(|| allowed_profile_ids.first())
        .cloned()
}

#[cfg(target_os = "macos")]
fn read_source_codec(path: &Path) -> Option<&'static str> {
    let stdout = read_afinfo_stdout(path)?;
    parse_afinfo_codec(&stdout)
}

#[cfg(not(target_os = "macos"))]
fn read_source_codec(_path: &Path) -> Option<&'static str> {
    None
}

#[cfg(target_os = "macos")]
fn parse_afinfo_codec(stdout: &str) -> Option<&'static str> {
    for line in stdout.lines() {
        let trimmed = line.trim();
        if !trimmed.starts_with("Data format:") {
            continue;
        }
        let lower = trimmed.to_ascii_lowercase();
        if lower.contains("alac") {
            return Some("alac");
        }
        if lower.contains("aac") {
            return Some("aac");
        }
        if lower.contains("flac") {
            return Some("flac");
        }
    }
    None
}

#[cfg(target_os = "macos")]
fn infer_mp3_profile_id(path: &Path) -> Option<&'static str> {
    let bitrate = read_audio_bitrate_bps(path)?;
    if bitrate >= 280_000 {
        Some("mp3-high")
    } else if bitrate <= 160_000 {
        Some("mp3-compact")
    } else {
        None
    }
}

#[cfg(not(target_os = "macos"))]
fn infer_mp3_profile_id(_path: &Path) -> Option<&'static str> {
    None
}

#[cfg(target_os = "macos")]
fn read_afinfo_stdout(path: &Path) -> Option<String> {
    use std::process::Command;

    let output = Command::new("afinfo").arg(path).output().ok()?;
    if !output.status.success() {
        return None;
    }

    Some(String::from_utf8_lossy(&output.stdout).into_owned())
}

#[cfg(target_os = "macos")]
fn read_audio_bitrate_bps(path: &Path) -> Option<u32> {
    let stdout = read_afinfo_stdout(path)?;
    for line in stdout.lines() {
        let trimmed = line.trim();
        let Some(rest) = trimmed.strip_prefix("bit rate:") else {
            continue;
        };
        let number = rest
            .split_whitespace()
            .next()
            .and_then(|value| value.parse::<u32>().ok())?;
        return Some(number);
    }

    None
}

/// Build `afconvert` arguments for a profile (excluding input/output paths).
pub fn afconvert_args(profile: &EncodingProfile) -> Vec<&'static str> {
    match profile.id {
        "lossless-flac" => vec!["-f", "flac", "-d", "flac"],
        "apple-aac" => vec![
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
        ],
        "mp3-high" | "mp3-compact" => {
            unreachable!("MP3 profiles use afconvert decode + LAME encode")
        }
        other => unreachable!("missing afconvert args for profile {other}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn profile_lookup_returns_all_builtins() {
        for id in [
            "lossless-flac",
            "apple-aac",
            "mp3-high",
            "mp3-compact",
        ] {
            assert_eq!(profile_from_id(id).unwrap().id, id);
        }
    }

    #[test]
    fn profile_lookup_rejects_unknown_id() {
        assert!(profile_from_id("vorbis").is_err());
    }

    #[test]
    fn extension_mapping() {
        let cases = [
            ("lossless-flac", "flac"),
            ("apple-aac", "m4a"),
            ("mp3-high", "mp3"),
            ("mp3-compact", "mp3"),
        ];
        for (id, ext) in cases {
            assert_eq!(profile_from_id(id).unwrap().extension, ext);
        }
    }

    #[test]
    fn afconvert_args_for_lossless_flac() {
        let profile = profile_from_id("lossless-flac").unwrap();
        assert_eq!(afconvert_args(profile), vec!["-f", "flac", "-d", "flac"]);
    }

    #[test]
    fn afconvert_args_for_apple_aac() {
        let profile = profile_from_id("apple-aac").unwrap();
        assert_eq!(
            afconvert_args(profile),
            vec![
                "-f", "m4af", "-d", "aac", "-b", "256000", "-q", "127", "-s", "2",
            ]
        );
    }

    #[test]
    fn mp3_profiles_are_identified() {
        assert!(profile_is_mp3("mp3-high"));
        assert!(profile_is_mp3("mp3-compact"));
        assert!(!profile_is_mp3("apple-aac"));
    }

    #[test]
    fn source_matches_lossless_flac_by_extension() {
        assert!(source_matches_profile(
            Path::new("/music/album/track.flac"),
            "lossless-flac",
        ));
        assert!(!source_matches_profile(
            Path::new("/music/album/track.flac"),
            "apple-aac",
        ));
    }

    #[test]
    fn blocks_noop_and_lossy_to_lossless_convert() {
        assert!(source_is_lossless(Path::new("/music/album/track.flac")));
        assert!(!source_is_lossless(Path::new("/music/album/track.m4a")));
        assert!(!can_convert_to_profile(
            Path::new("/music/album/track.flac"),
            "lossless-flac",
        ));
        assert!(can_convert_to_profile(
            Path::new("/music/album/track.m4a"),
            "apple-aac",
        ));
        assert!(!can_convert_to_profile(
            Path::new("/music/album/track.m4a"),
            "lossless-flac",
        ));
        assert!(can_convert_to_profile(
            Path::new("/music/album/track.flac"),
            "apple-aac",
        ));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn parse_afinfo_codec_detects_alac_before_aac() {
        let stdout = "Data format:     2 ch,  44100 Hz, alac (0x00000001) from 16-bit source";
        assert_eq!(parse_afinfo_codec(stdout), Some("alac"));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn parse_afinfo_codec_detects_aac() {
        let stdout = "Data format:     2 ch,  44100 Hz, aac (0x00000000) 256000 bits/sec";
        assert_eq!(parse_afinfo_codec(stdout), Some("aac"));
    }
}
