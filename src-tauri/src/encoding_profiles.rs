//! Built-in encoding profiles shared by CD rip and library convert.

use crate::audio_properties;
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
        id: "apple-alac",
        label: "Apple Lossless (ALAC)",
        subtitle: "Lossless quality for Apple devices",
        extension: "m4a",
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
    /// Best-match built-in profile for the first source file, if any.
    pub source_profile_id: Option<String>,
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
        "m4a" => infer_m4a_profile_id(read_source_codec(path)),
        "mp3" => infer_mp3_profile_id(path),
        _ => None,
    }
}

pub fn source_matches_profile(path: &Path, profile_id: &str) -> bool {
    infer_profile_id_from_file(path) == Some(profile_id)
}

pub fn profile_is_lossless(profile_id: &str) -> bool {
    matches!(profile_id, "lossless-flac" | "apple-alac")
}

pub(crate) fn profile_is_alac(profile_id: &str) -> bool {
    profile_id == "apple-alac"
}

pub(crate) fn profile_is_mp3(profile_id: &str) -> bool {
    matches!(profile_id, "mp3-high" | "mp3-compact")
}

pub(crate) fn profile_is_flac(profile_id: &str) -> bool {
    profile_id == "lossless-flac"
}

pub fn source_is_lossless(path: &Path) -> bool {
    let Some(ext) = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
    else {
        return false;
    };

    match ext.as_str() {
        // WAV is uncompressed PCM in Spiral's library path — valid lossless→lossless source.
        "flac" | "wav" => true,
        "m4a" => read_source_codec(path) == Some("alac"),
        _ => false,
    }
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

    let source_profile_id = infer_profile_id_from_file(&source_paths[0]).map(str::to_string);

    Ok(ConvertProfileOptions {
        profile_ids,
        default_profile_id,
        source_profile_id,
    })
}

fn infer_m4a_profile_id(codec: Option<&str>) -> Option<&'static str> {
    match codec {
        Some("alac") => Some("apple-alac"),
        Some("aac") => Some("apple-aac"),
        _ => None,
    }
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

fn read_source_codec(path: &Path) -> Option<&'static str> {
    match audio_properties::read_audio_properties(path).codec.as_deref()? {
        "alac" => Some("alac"),
        "aac" => Some("aac"),
        "flac" => Some("flac"),
        _ => None,
    }
}

fn infer_mp3_profile_id(path: &Path) -> Option<&'static str> {
    let bitrate = audio_properties::read_audio_properties(path).bitrate?;
    if bitrate >= 280_000 {
        Some("mp3-high")
    } else if bitrate <= 160_000 {
        Some("mp3-compact")
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn profile_lookup_returns_all_builtins() {
        for id in [
            "lossless-flac",
            "apple-alac",
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
            ("apple-alac", "m4a"),
            ("apple-aac", "m4a"),
            ("mp3-high", "mp3"),
            ("mp3-compact", "mp3"),
        ];
        for (id, ext) in cases {
            assert_eq!(profile_from_id(id).unwrap().extension, ext);
        }
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
        assert!(source_is_lossless(Path::new("/music/album/track.wav")));
        assert!(!source_is_lossless(Path::new("/music/album/track.m4a")));
        assert!(!source_is_lossless(Path::new("/music/album/track.mp3")));
        assert!(!can_convert_to_profile(
            Path::new("/music/album/track.flac"),
            "lossless-flac",
        ));
        assert!(can_convert_to_profile(
            Path::new("/music/album/track.flac"),
            "apple-alac",
        ));
        assert!(can_convert_to_profile(
            Path::new("/music/album/track.wav"),
            "lossless-flac",
        ));
        assert!(can_convert_to_profile(
            Path::new("/music/album/track.wav"),
            "apple-alac",
        ));
        assert!(can_convert_to_profile(
            Path::new("/music/album/track.m4a"),
            "apple-aac",
        ));
        assert!(!can_convert_to_profile(
            Path::new("/music/album/track.m4a"),
            "lossless-flac",
        ));
        assert!(!can_convert_to_profile(
            Path::new("/music/album/track.m4a"),
            "apple-alac",
        ));
        assert!(can_convert_to_profile(
            Path::new("/music/album/track.flac"),
            "apple-aac",
        ));
    }

    #[test]
    fn infer_m4a_profile_id_maps_codecs() {
        assert_eq!(infer_m4a_profile_id(Some("alac")), Some("apple-alac"));
        assert_eq!(infer_m4a_profile_id(Some("aac")), Some("apple-aac"));
        assert_eq!(infer_m4a_profile_id(None), None);
    }

    #[test]
    fn apple_alac_is_lossless_output_profile() {
        assert!(profile_is_lossless("apple-alac"));
        assert!(profile_is_alac("apple-alac"));
        assert!(!profile_is_alac("apple-aac"));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn infer_profile_id_from_aac_m4a_fixture() {
        let path = crate::test_fixtures::m4a::moov_before_mdat_fixture_path();
        assert_eq!(infer_profile_id_from_file(&path), Some("apple-aac"));
    }
}
