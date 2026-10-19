//! Shared building blocks of the item format: archive and file conventions, the type folder
//! table, preview-path validation, and id / version syntax checks. The per-item manifest itself
//! lives in `item.rs`.

use std::path::{Path, PathBuf};

/// Zip artifact extension for distributable packs.
pub const ARCHIVE_EXTENSION: &str = ".spk";

/// Optional long-form About body at the pack root (rendered in Studio).
pub const README_FILENAME: &str = "README.md";

/// Max README.md size accepted for read/write (bytes).
pub const README_MAX_BYTES: u64 = 256 * 1024;

/// Optional release history at the pack root (rendered in Studio Changelog).
pub const CHANGELOG_FILENAME: &str = "CHANGELOG.md";

/// Max CHANGELOG.md size accepted for read/write (bytes).
pub const CHANGELOG_MAX_BYTES: u64 = 256 * 1024;

/// Fixed type-folder → contribution type mapping used by the scanner.
pub const CONTRIBUTION_TYPE_FOLDERS: &[(&str, &str, &str)] = &[
    // (folder name, contribution type, manifest filename)
    ("themes", "theme", "theme.json"),
    ("skins", "skin", "skin.json"),
    ("visualizers", "visualizer", "viz.json"),
    ("sounds", "sound", "sound.json"),
];

/// Raster image extensions allowed for pack and contribution `preview` fields.
///
/// SVG is omitted: `image/svg+xml` is executable when opened as a document.
pub const ALLOWED_PREVIEW_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "webp", "gif"];

fn allowed_preview_exts_list() -> String {
    ALLOWED_PREVIEW_EXTENSIONS.join(", ")
}

/// Validate a declared preview path (shape + extension, no disk).
///
/// Rejects empty, traversal / absolute paths, missing extensions, and anything
/// outside [`ALLOWED_PREVIEW_EXTENSIONS`] (including SVG).
pub fn validate_preview_relpath(preview: &str) -> Result<(), String> {
    let trimmed = preview.trim();
    if trimmed.is_empty() {
        return Err("must be a non-empty string when present".to_string());
    }
    if trimmed.contains("..") || trimmed.starts_with('/') || trimmed.starts_with('\\') {
        return Err(format!(
            "must be a relative path (no .. or absolute), got: {preview}"
        ));
    }
    let ext = Path::new(trimmed)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .filter(|e| !e.is_empty());
    let Some(ext) = ext else {
        return Err(format!(
            "must have an image extension ({}), got: {preview}",
            allowed_preview_exts_list()
        ));
    };
    if !ALLOWED_PREVIEW_EXTENSIONS.contains(&ext.as_str()) {
        return Err(format!(
            "has unsupported extension \".{ext}\" (allowed: {})",
            allowed_preview_exts_list()
        ));
    }
    Ok(())
}

/// Validate a declared preview path and that the file exists under `dir`.
pub fn validate_preview_file(dir: &Path, preview: &str) -> Result<(), String> {
    validate_preview_relpath(preview).map_err(|message| format!("preview {message}"))?;
    let path = dir.join(preview.trim());
    if !path.is_file() {
        return Err(format!("preview not found: {}", path.display()));
    }
    Ok(())
}

/// Resolve an explicitly declared preview image relative to `dir`.
///
/// Contribution and pack previews must be declared in the manifest — there is
/// no filename convention fallback.
pub fn resolve_preview_file(dir: &Path, explicit: Option<&str>) -> Option<PathBuf> {
    let name = explicit.map(str::trim).filter(|s| !s.is_empty())?;
    let p = dir.join(name);
    p.is_file().then_some(p)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ManifestError {
    pub code: &'static str,
    pub message: String,
}

impl std::fmt::Display for ManifestError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for ManifestError {}

pub fn is_kebab_slug(value: &str) -> bool {
    let mut chars = value.chars().peekable();
    let mut saw_alnum = false;
    while let Some(ch) = chars.next() {
        if ch.is_ascii_lowercase() || ch.is_ascii_digit() {
            saw_alnum = true;
            continue;
        }
        if ch == '-' {
            if !saw_alnum {
                return false;
            }
            match chars.peek() {
                Some(n) if n.is_ascii_lowercase() || n.is_ascii_digit() => {}
                _ => return false,
            }
            continue;
        }
        return false;
    }
    saw_alnum
}

/// Permissive semver: MAJOR.MINOR.PATCH with optional pre-release / build.
pub(crate) fn is_semver(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.is_empty() {
        return false;
    }
    let mut i = 0;
    let mut parts = 0;
    while parts < 3 {
        if i >= bytes.len() || !bytes[i].is_ascii_digit() {
            return false;
        }
        while i < bytes.len() && bytes[i].is_ascii_digit() {
            i += 1;
        }
        parts += 1;
        if parts < 3 {
            if i >= bytes.len() || bytes[i] != b'.' {
                return false;
            }
            i += 1;
        }
    }
    if i == bytes.len() {
        return true;
    }
    if bytes[i] != b'-' && bytes[i] != b'+' {
        return false;
    }
    i += 1;
    if i >= bytes.len() {
        return false;
    }
    bytes[i..]
        .iter()
        .all(|b| b.is_ascii_alphanumeric() || *b == b'.' || *b == b'-')
}

/// Convenience: whether a path looks like a pack archive (by extension).
pub fn is_spk_path(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("spk"))
}

/// Slugify free text into a kebab-case id (shared by pack/theme/author defaults).
pub fn slugify_id(input: &str) -> String {
    let mut out = String::new();
    let mut pending_hyphen = false;
    for ch in input.chars() {
        if ch.is_ascii_alphanumeric() {
            if pending_hyphen && !out.is_empty() {
                out.push('-');
            }
            pending_hyphen = false;
            out.push(ch.to_ascii_lowercase());
        } else if !out.is_empty() {
            pending_hyphen = true;
        }
    }
    if out.is_empty() {
        "untitled".to_string()
    } else {
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SKIN_SCHEMA: &str = include_str!("../schemas/skin-v1.schema.json");
    const VIZ_SCHEMA: &str = include_str!("../schemas/viz-v1.schema.json");

    #[test]
    fn archive_extension_is_spk() {
        assert_eq!(ARCHIVE_EXTENSION, ".spk");
        assert!(is_spk_path(Path::new("midnight-drive.spk")));
        assert!(!is_spk_path(Path::new("midnight-drive.sp")));
    }

    #[test]
    fn type_folders_map_to_manifest_files() {
        let folders: Vec<_> = CONTRIBUTION_TYPE_FOLDERS
            .iter()
            .map(|(folder, ty, file)| (*folder, *ty, *file))
            .collect();
        assert_eq!(
            folders,
            vec![
                ("themes", "theme", "theme.json"),
                ("skins", "skin", "skin.json"),
                ("visualizers", "visualizer", "viz.json"),
                ("sounds", "sound", "sound.json"),
            ]
        );
    }

    #[test]
    fn kebab_slugs_and_semver() {
        assert!(is_kebab_slug("midnight-drive"));
        assert!(is_kebab_slug("t3"));
        for bad in ["", "-a", "a-", "a--b", "A", "a_b", "a b"] {
            assert!(!is_kebab_slug(bad), "{bad:?}");
        }
        assert!(is_semver("1.2.3"));
        assert!(is_semver("1.2.3-beta.1"));
        assert!(is_semver("1.2.3+build.5"));
        for bad in ["", "1.2", "1.2.3.", "v1.2.3", "1.2.3-"] {
            assert!(!is_semver(bad), "{bad:?}");
        }
    }

    #[test]
    fn validate_preview_relpath_allows_raster_rejects_svg() {
        assert!(validate_preview_relpath("preview.png").is_ok());
        assert!(validate_preview_relpath("art/hero.webp").is_ok());
        assert!(validate_preview_relpath("Preview.JPG").is_ok());
        assert!(validate_preview_relpath("preview.svg").is_err());
        assert!(validate_preview_relpath("preview.SVG").is_err());
        assert!(validate_preview_relpath("../preview.png").is_err());
        assert!(validate_preview_relpath("/tmp/preview.png").is_err());
    }

    #[test]
    fn validate_preview_file_rejects_svg_even_when_present() {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("spk-format-preview-svg-{nanos}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("preview.svg"), b"<svg></svg>").unwrap();
        std::fs::write(dir.join("preview.png"), b"y").unwrap();
        assert!(validate_preview_file(&dir, "preview.png").is_ok());
        let err = validate_preview_file(&dir, "preview.svg").unwrap_err();
        assert!(err.contains("unsupported extension"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn schema_preview_excludes_svg() {
        for schema in [SKIN_SCHEMA, VIZ_SCHEMA] {
            let schema: serde_json::Value = serde_json::from_str(schema).unwrap();
            let pattern = schema["properties"]["preview"]["pattern"]
                .as_str()
                .expect("preview pattern");
            assert!(pattern.contains("png"));
            assert!(!pattern.contains("svg"));
        }
    }

    #[test]
    fn resolve_preview_file_requires_explicit() {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("spk-format-preview-{nanos}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("custom.webp"), b"x").unwrap();
        std::fs::write(dir.join("preview.png"), b"y").unwrap();
        let resolved = resolve_preview_file(&dir, Some("custom.webp")).unwrap();
        assert_eq!(resolved.file_name().unwrap(), "custom.webp");
        assert!(resolve_preview_file(&dir, None).is_none());
        assert!(resolve_preview_file(&dir, Some("missing.png")).is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn slugify_id_normalizes() {
        assert_eq!(slugify_id("Bryan H"), "bryan-h");
        assert_eq!(slugify_id("  "), "untitled");
        assert_eq!(slugify_id("T3: Skynet"), "t3-skynet");
    }
}
