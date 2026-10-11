//! Theme contribution validation (`theme.json`).

use crate::is_kebab_slug;
use serde::Deserialize;
use std::collections::HashMap;
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Deserialize)]
struct ThemeFile {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    name: String,
    #[serde(default)]
    #[allow(dead_code)]
    author: String,
    #[serde(default)]
    #[allow(dead_code)]
    description: String,
    #[serde(default)]
    tokens: HashMap<String, String>,
}

/// Required token keys for installing / applying a theme (mirrors theme-v1 / TS).
pub const REQUIRED_THEME_TOKEN_KEYS: &[&str] = &[
    "color-bg",
    "color-surface",
    "color-text-primary",
    "color-text-secondary",
    "color-accent",
    "color-accent-muted",
    "color-border",
    "color-danger",
    "radius-card",
    "radius-button",
    "font-ui",
];

/// Strict theme contribution check used by pack install/export.
pub fn validate_theme_contribution_at(manifest_path: &Path) -> Result<(), String> {
    let contents = fs::read_to_string(manifest_path)
        .map_err(|e| format!("could not read theme {}: {e}", manifest_path.display()))?;
    let file: ThemeFile = serde_json::from_str(&contents)
        .map_err(|e| format!("{} is not valid theme JSON: {e}", manifest_path.display()))?;
    let declared_id = file
        .id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "theme id is required".to_string())?;
    if !is_kebab_slug(declared_id) {
        return Err(format!(
            "theme id must be a kebab-case slug, got: {declared_id}"
        ));
    }
    if file.name.trim().is_empty() {
        return Err("theme name is required".into());
    }
    let mut missing = Vec::new();
    for key in REQUIRED_THEME_TOKEN_KEYS {
        let ok = file
            .tokens
            .get(*key)
            .map(|v| !v.trim().is_empty())
            .unwrap_or(false);
        if !ok {
            missing.push(*key);
        }
    }
    if !missing.is_empty() {
        return Err(format!("missing required tokens: {}", missing.join(", ")));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_theme(dir: &std::path::Path, json: &str) -> std::path::PathBuf {
        std::fs::create_dir_all(dir).unwrap();
        let path = dir.join("theme.json");
        std::fs::write(&path, json).unwrap();
        path
    }

    fn tokens_json() -> String {
        let pairs: Vec<String> = REQUIRED_THEME_TOKEN_KEYS
            .iter()
            .map(|k| format!(r#"    "{k}": "x""#))
            .collect();
        pairs.join(",\n")
    }

    #[test]
    fn accepts_minimal_valid_theme() {
        let dir = std::env::temp_dir().join(format!("spk-theme-ok-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let json = format!(
            "{{\n  \"id\": \"noir\",\n  \"name\": \"Noir\",\n  \"tokens\": {{\n{}\n  }}\n}}",
            tokens_json()
        );
        let path = write_theme(&dir, &json);
        validate_theme_contribution_at(&path).unwrap();
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_missing_tokens() {
        let dir = std::env::temp_dir().join(format!("spk-theme-bad-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let path = write_theme(
            &dir,
            r##"{ "id": "noir", "name": "Noir", "tokens": { "color-bg": "#000" } }"##,
        );
        let err = validate_theme_contribution_at(&path).unwrap_err();
        assert!(err.contains("missing required tokens"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
