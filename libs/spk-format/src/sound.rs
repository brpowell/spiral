//! Sound pack validation (`sound.json`).
//!
//! A sound pack is a library of named sounds plus an author-chosen assignment of
//! those sounds to cues. Activating the pack applies the assignment; the sounds
//! stay individually addressable by id.

use crate::is_kebab_slug;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

/// Cues the app plays today. A pack may define others; unknown cues are ignored
/// by apps that do not know them, so packs written for a newer app still install.
pub const KNOWN_SOUND_CUES: &[&str] = &["transportPlay", "transportControl"];

/// Parsed `sound.json`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SoundManifest {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub description: String,
    /// Sound id → `.wav` path relative to the item root.
    pub sounds: BTreeMap<String, String>,
    /// Cue name → sound id.
    #[serde(default)]
    pub cues: BTreeMap<String, String>,
}

pub fn read_sound_manifest(path: &Path) -> Result<SoundManifest, String> {
    let contents = fs::read_to_string(path)
        .map_err(|e| format!("could not read sound pack {}: {e}", path.display()))?;
    let contents = contents.strip_prefix('\u{feff}').unwrap_or(&contents);
    serde_json::from_str(contents)
        .map_err(|e| format!("{} is not valid sound pack JSON: {e}", path.display()))
}

fn is_safe_sound_asset_path(path: &str) -> bool {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return false;
    }
    if trimmed.contains("..")
        || trimmed.contains('\\')
        || trimmed.starts_with('/')
        || Path::new(trimmed).is_absolute()
    {
        return false;
    }
    trimmed.to_ascii_lowercase().ends_with(".wav")
}

/// Cue names are lowerCamelCase identifiers (`transportPlay`).
fn is_cue_name(name: &str) -> bool {
    let mut chars = name.chars();
    chars.next().is_some_and(|c| c.is_ascii_lowercase()) && chars.all(|c| c.is_ascii_alphanumeric())
}

/// Strict sound pack check used by item install/export.
pub fn validate_sound_contribution_at(manifest_path: &Path) -> Result<(), String> {
    let item_dir = manifest_path.parent().ok_or_else(|| {
        format!(
            "sound manifest has no parent directory: {}",
            manifest_path.display()
        )
    })?;
    let pack = read_sound_manifest(manifest_path)?;

    let declared_id = pack.id.trim();
    if declared_id.is_empty() {
        return Err("sound pack id is required".into());
    }
    if !is_kebab_slug(declared_id) {
        return Err(format!(
            "sound pack id must be a kebab-case slug, got: {declared_id}"
        ));
    }
    if pack.name.trim().is_empty() {
        return Err("sound pack name is required".into());
    }
    if pack.sounds.is_empty() {
        return Err("sound pack must declare at least one sound".into());
    }

    for (sound_id, asset) in &pack.sounds {
        if !is_kebab_slug(sound_id) {
            return Err(format!(
                "sound id must be a kebab-case slug, got: {sound_id}"
            ));
        }
        if !is_safe_sound_asset_path(asset) {
            return Err(format!(
                "sounds.{sound_id} \"{asset}\" must be a relative .wav path inside the pack"
            ));
        }
        let asset_path = item_dir.join(asset);
        if !asset_path.is_file() {
            return Err(format!(
                "sounds.{sound_id} asset file not found at {}",
                asset_path.display()
            ));
        }
    }

    for (cue, sound_id) in &pack.cues {
        if !is_cue_name(cue) {
            return Err(format!(
                "cue name must be lowerCamelCase letters and digits, got: {cue}"
            ));
        }
        if !pack.sounds.contains_key(sound_id) {
            return Err(format!("cues.{cue} refers to unknown sound \"{sound_id}\""));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_pack(label: &str, body: &str, wavs: &[&str]) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("spk-sound-{label}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("sounds")).unwrap();
        for wav in wavs {
            fs::write(dir.join(wav), b"RIFF....WAVE").unwrap();
        }
        let path = dir.join("sound.json");
        fs::write(&path, body).unwrap();
        path
    }

    fn cleanup(path: &Path) {
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    const VALID: &str = r#"{
        "id": "arcade", "name": "Arcade", "author": "A", "description": "",
        "sounds": {"blip": "sounds/blip.wav", "chime": "sounds/chime.wav"},
        "cues": {"transportPlay": "chime", "transportControl": "blip"}
    }"#;

    #[test]
    fn accepts_valid_pack_and_reuse_of_one_sound() {
        let path = write_pack("ok", VALID, &["sounds/blip.wav", "sounds/chime.wav"]);
        validate_sound_contribution_at(&path).unwrap();
        let pack = read_sound_manifest(&path).unwrap();
        assert_eq!(pack.cues["transportControl"], "blip");
        cleanup(&path);

        let reuse = r#"{"id":"x","name":"X","sounds":{"click":"sounds/click.wav"},
            "cues":{"transportPlay":"click","transportControl":"click"}}"#;
        let path = write_pack("reuse", reuse, &["sounds/click.wav"]);
        validate_sound_contribution_at(&path).unwrap();
        cleanup(&path);
    }

    #[test]
    fn accepts_pack_without_cues_and_unknown_cues() {
        let body = r#"{"id":"x","name":"X","sounds":{"a":"a.wav"},"cues":{"futureCue":"a"}}"#;
        let path = write_pack("unknown", body, &["a.wav"]);
        validate_sound_contribution_at(&path).unwrap();
        cleanup(&path);

        let body = r#"{"id":"x","name":"X","sounds":{"a":"a.wav"}}"#;
        let path = write_pack("nocues", body, &["a.wav"]);
        validate_sound_contribution_at(&path).unwrap();
        cleanup(&path);
    }

    #[test]
    fn rejects_missing_asset_file() {
        let path = write_pack("missing", VALID, &["sounds/blip.wav"]);
        let err = validate_sound_contribution_at(&path).unwrap_err();
        assert!(err.contains("not found") && err.contains("chime"), "{err}");
        cleanup(&path);
    }

    #[test]
    fn rejects_unsafe_or_non_wav_assets() {
        for asset in ["../a.wav", "/a.wav", "sounds\\a.wav", "a.mp3", ""] {
            let body = format!(r#"{{"id":"x","name":"X","sounds":{{"a":"{asset}"}}}}"#)
                .replace('\\', "\\\\");
            let path = write_pack("unsafe", &body, &["a.wav"]);
            let err = validate_sound_contribution_at(&path).unwrap_err();
            assert!(err.contains("relative .wav"), "{asset}: {err}");
            cleanup(&path);
        }
    }

    #[test]
    fn rejects_cue_to_unknown_sound() {
        let body = r#"{"id":"x","name":"X","sounds":{"a":"a.wav"},"cues":{"transportPlay":"b"}}"#;
        let path = write_pack("badcue", body, &["a.wav"]);
        let err = validate_sound_contribution_at(&path).unwrap_err();
        assert!(err.contains("unknown sound"), "{err}");
        cleanup(&path);
    }

    #[test]
    fn rejects_bad_ids_names_and_empty_packs() {
        let cases = [
            (r#"{"id":"Bad","name":"X","sounds":{"a":"a.wav"}}"#, "kebab"),
            (r#"{"id":"x","name":" ","sounds":{"a":"a.wav"}}"#, "name"),
            (r#"{"id":"x","name":"X","sounds":{}}"#, "at least one"),
            (
                r#"{"id":"x","name":"X","sounds":{"Not Kebab":"a.wav"}}"#,
                "kebab",
            ),
            (
                r#"{"id":"x","name":"X","sounds":{"a":"a.wav"},"cues":{"Transport_Play":"a"}}"#,
                "lowerCamelCase",
            ),
        ];
        for (body, needle) in cases {
            let path = write_pack("bad", body, &["a.wav"]);
            let err = validate_sound_contribution_at(&path).unwrap_err();
            assert!(err.contains(needle), "{body}: {err}");
            cleanup(&path);
        }
    }
}
