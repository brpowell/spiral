//! Pack preview extraction helpers (publish-time sidecar).

use std::path::{Component, Path};

use crate::publish::PublishError;

/// Max bytes accepted for a pack preview sidecar (5 MiB).
pub const MAX_PREVIEW_BYTES: u64 = 5 * 1024 * 1024;

// Raster-only; SVG is not permitted (executable when opened as a document).
const ALLOWED_PREVIEW_EXTS: &[&str] = &["png", "jpg", "jpeg", "webp", "gif"];

/// Storage object key for a version's `.spk` archive.
pub fn pack_storage_key(author_id: &str, pack_id: &str, version: &str) -> String {
    format!("{author_id}/{pack_id}/{version}/pack.spk")
}

/// Storage object key for a version's pack preview.
pub fn preview_storage_key(author_id: &str, pack_id: &str, version: &str, ext: &str) -> String {
    let ext = ext.trim_start_matches('.').to_ascii_lowercase();
    format!("{author_id}/{pack_id}/{version}/preview.{ext}")
}

/// Public API path for a version's pack preview.
pub fn preview_url_path(author_id: &str, pack_id: &str, version: &str) -> String {
    format!("/v1/packs/{author_id}/{pack_id}/versions/{version}/preview")
}

pub fn content_type_for_preview_key(storage_key: &str) -> &'static str {
    let ext = storage_key
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        _ => "application/octet-stream",
    }
}

/// Read a pack preview image from an extracted pack root.
///
/// `preview_rel` is a pack-root-relative path (from `pack.json` or auto-detection).
/// Returns `(bytes, extension_without_dot)` when present. Declared-but-missing /
/// unsafe paths are errors so publishers get a clear failure.
pub fn read_pack_preview(
    pack_dir: &Path,
    preview_rel: Option<&str>,
) -> Result<Option<(Vec<u8>, String)>, PublishError> {
    let Some(raw) = preview_rel.map(str::trim).filter(|s| !s.is_empty()) else {
        return Ok(None);
    };

    let rel = raw.replace('\\', "/");
    if rel.starts_with('/') || rel.contains('\0') {
        return Err(PublishError::invalid(format!(
            "pack preview \"{raw}\" must be a relative path under the pack root"
        )));
    }

    let path = Path::new(&rel);
    if path
        .components()
        .any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err(PublishError::invalid(format!(
            "pack preview \"{raw}\" must be a relative path under the pack root"
        )));
    }

    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .ok_or_else(|| {
            PublishError::invalid(format!(
                "pack preview \"{raw}\" must have an image extension ({})",
                ALLOWED_PREVIEW_EXTS.join(", ")
            ))
        })?;
    if !ALLOWED_PREVIEW_EXTS.iter().any(|a| *a == ext) {
        return Err(PublishError::invalid(format!(
            "pack preview \"{raw}\" has unsupported extension \".{ext}\" (allowed: {})",
            ALLOWED_PREVIEW_EXTS.join(", ")
        )));
    }

    let abs = pack_dir.join(path);
    if !abs.is_file() {
        return Err(PublishError::invalid(format!(
            "pack preview \"{raw}\" not found in pack"
        )));
    }

    let meta = std::fs::metadata(&abs).map_err(|e| {
        PublishError::invalid(format!("failed to stat pack preview \"{raw}\": {e}"))
    })?;
    if meta.len() > MAX_PREVIEW_BYTES {
        return Err(PublishError::invalid(format!(
            "pack preview \"{raw}\" exceeds {MAX_PREVIEW_BYTES} bytes"
        )));
    }

    let bytes = std::fs::read(&abs).map_err(|e| {
        PublishError::invalid(format!("failed to read pack preview \"{raw}\": {e}"))
    })?;
    Ok(Some((bytes, ext)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn read_pack_preview_none_when_absent() {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("spk-registry-preview-{nanos}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        assert!(read_pack_preview(&dir, None).unwrap().is_none());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_pack_preview_loads_bytes() {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("spk-registry-preview-ok-{nanos}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("preview.png"), b"\x89PNG").unwrap();
        let (bytes, ext) = read_pack_preview(&dir, Some("preview.png"))
            .unwrap()
            .unwrap();
        assert_eq!(ext, "png");
        assert_eq!(bytes, b"\x89PNG");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn preview_url_path_uses_preview_segment() {
        assert_eq!(
            preview_url_path("a", "b", "1.0.0"),
            "/v1/packs/a/b/versions/1.0.0/preview"
        );
        assert_eq!(
            preview_storage_key("a", "b", "1.0.0", "webp"),
            "a/b/1.0.0/preview.webp"
        );
    }

    #[test]
    fn read_pack_preview_rejects_svg() {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("spk-registry-preview-svg-{nanos}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("preview.svg"), b"<svg></svg>").unwrap();
        let err = read_pack_preview(&dir, Some("preview.svg")).unwrap_err();
        assert!(err.to_string().contains("unsupported extension"), "{err}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn content_type_does_not_serve_svg_as_image() {
        assert_eq!(
            content_type_for_preview_key("a/b/1.0.0/preview.png"),
            "image/png"
        );
        assert_eq!(
            content_type_for_preview_key("a/b/1.0.0/preview.svg"),
            "application/octet-stream"
        );
    }
}
