//! Sound contribution validation (`sound.json`).

use crate::is_kebab_slug;
use serde::Deserialize;
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Deserialize)]
struct SoundFile {
    id: String,
    name: String,
    #[serde(default)]
    #[allow(dead_code)]
    author: String,
    #[serde(default)]
    #[allow(dead_code)]
    description: String,
    asset: String,
}

fn is_safe_sound_asset_path(path: &str) -> bool {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return false;
    }
    if trimmed.contains("..") || trimmed.starts_with('/') || trimmed.starts_with('\\') {
        return false;
    }
    if Path::new(trimmed).is_absolute() {
        return false;
    }
    let lower = trimmed.to_ascii_lowercase();
    lower.ends_with(".wav")
}

/// Strict sound contribution check used by pack install/export.
pub fn validate_sound_contribution_at(manifest_path: &Path) -> Result<(), String> {
    let contribution_dir = manifest_path.parent().ok_or_else(|| {
        format!(
            "sound manifest has no parent directory: {}",
            manifest_path.display()
        )
    })?;
    let contents = fs::read_to_string(manifest_path)
        .map_err(|e| format!("could not read sound {}: {e}", manifest_path.display()))?;
    let file: SoundFile = serde_json::from_str(&contents)
        .map_err(|e| format!("{} is not valid sound JSON: {e}", manifest_path.display()))?;

    let declared_id = file.id.trim();
    if declared_id.is_empty() {
        return Err("sound id is required".into());
    }
    if !is_kebab_slug(declared_id) {
        return Err(format!(
            "sound id must be a kebab-case slug, got: {declared_id}"
        ));
    }
    if file.name.trim().is_empty() {
        return Err("sound name is required".into());
    }
    if !is_safe_sound_asset_path(&file.asset) {
        return Err(format!(
            "{}: asset \"{}\" must be a relative .wav path under the contribution directory",
            manifest_path.display(),
            file.asset
        ));
    }
    let asset_path = contribution_dir.join(&file.asset);
    if !asset_path.is_file() {
        return Err(format!(
            "{}: asset file not found at {}",
            manifest_path.display(),
            asset_path.display()
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_sound(dir: &Path, body: &str, wav_name: Option<&str>) -> std::path::PathBuf {
        let _ = fs::remove_dir_all(dir);
        fs::create_dir_all(dir).unwrap();
        if let Some(name) = wav_name {
            fs::write(dir.join(name), b"RIFF....WAVE").unwrap();
        }
        let path = dir.join("sound.json");
        fs::write(&path, body).unwrap();
        path
    }

    #[test]
    fn accepts_valid_sound() {
        let dir = std::env::temp_dir().join(format!("spk-sound-ok-{}", std::process::id()));
        let path = write_sound(
            &dir,
            r#"{"id":"play","name":"Play","author":"Spiral","description":"","asset":"play.wav"}"#,
            Some("play.wav"),
        );
        validate_sound_contribution_at(&path).unwrap();
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_missing_asset_file() {
        let dir = std::env::temp_dir().join(format!("spk-sound-missing-{}", std::process::id()));
        let path = write_sound(
            &dir,
            r#"{"id":"play","name":"Play","author":"Spiral","description":"","asset":"play.wav"}"#,
            None,
        );
        let err = validate_sound_contribution_at(&path).unwrap_err();
        assert!(err.contains("not found"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_parent_path_asset() {
        let dir = std::env::temp_dir().join(format!("spk-sound-parent-{}", std::process::id()));
        let path = write_sound(
            &dir,
            r#"{"id":"play","name":"Play","author":"Spiral","description":"","asset":"../play.wav"}"#,
            Some("play.wav"),
        );
        let err = validate_sound_contribution_at(&path).unwrap_err();
        assert!(err.contains("relative"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_bad_id() {
        let dir = std::env::temp_dir().join(format!("spk-sound-id-{}", std::process::id()));
        let path = write_sound(
            &dir,
            r#"{"id":"TransportPlay","name":"Play","author":"Spiral","description":"","asset":"play.wav"}"#,
            Some("play.wav"),
        );
        let err = validate_sound_contribution_at(&path).unwrap_err();
        assert!(err.contains("kebab"));
        let _ = fs::remove_dir_all(&dir);
    }
}
