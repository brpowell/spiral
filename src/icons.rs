//! Pack icon extraction helpers (publish-time sidecar).

use std::path::{Component, Path};

use crate::publish::PublishError;

/// Max bytes accepted for a pack icon sidecar (2 MiB).
pub const MAX_ICON_BYTES: u64 = 2 * 1024 * 1024;

const ALLOWED_ICON_EXTS: &[&str] = &["png", "jpg", "jpeg", "webp", "gif", "svg"];

/// Storage object key for a version's `.spk` archive.
pub fn pack_storage_key(author_id: &str, pack_id: &str, version: &str) -> String {
    format!("{author_id}/{pack_id}/{version}/pack.spk")
}

/// Storage object key for a version's pack icon.
pub fn icon_storage_key(author_id: &str, pack_id: &str, version: &str, ext: &str) -> String {
    let ext = ext.trim_start_matches('.').to_ascii_lowercase();
    format!("{author_id}/{pack_id}/{version}/icon.{ext}")
}

/// Public API path for a version's pack icon.
pub fn icon_url_path(author_id: &str, pack_id: &str, version: &str) -> String {
    format!("/v1/packs/{author_id}/{pack_id}/versions/{version}/icon")
}

pub fn content_type_for_icon_key(storage_key: &str) -> &'static str {
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
        "svg" => "image/svg+xml",
        _ => "application/octet-stream",
    }
}

/// Read `pack.json`'s `icon` file from an extracted pack root.
///
/// Returns `(bytes, extension_without_dot)` when present. Declared-but-missing /
/// unsafe paths are errors so publishers get a clear failure.
pub fn read_pack_icon(
    pack_dir: &Path,
    icon_rel: Option<&str>,
) -> Result<Option<(Vec<u8>, String)>, PublishError> {
    let Some(raw) = icon_rel.map(str::trim).filter(|s| !s.is_empty()) else {
        return Ok(None);
    };

    let rel = raw.replace('\\', "/");
    if rel.starts_with('/') || rel.contains('\0') {
        return Err(PublishError::invalid(format!(
            "pack.json icon \"{raw}\" must be a relative path under the pack root"
        )));
    }

    let path = Path::new(&rel);
    if path
        .components()
        .any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err(PublishError::invalid(format!(
            "pack.json icon \"{raw}\" must be a relative path under the pack root"
        )));
    }

    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .ok_or_else(|| {
            PublishError::invalid(format!(
                "pack.json icon \"{raw}\" must have an image extension ({})",
                ALLOWED_ICON_EXTS.join(", ")
            ))
        })?;
    if !ALLOWED_ICON_EXTS.iter().any(|a| *a == ext) {
        return Err(PublishError::invalid(format!(
            "pack.json icon \"{raw}\" has unsupported extension \".{ext}\" (allowed: {})",
            ALLOWED_ICON_EXTS.join(", ")
        )));
    }

    let abs = pack_dir.join(path);
    if !abs.is_file() {
        return Err(PublishError::invalid(format!(
            "pack.json icon \"{raw}\" not found in pack"
        )));
    }

    let meta = std::fs::metadata(&abs).map_err(|e| {
        PublishError::invalid(format!("failed to stat pack icon \"{raw}\": {e}"))
    })?;
    if meta.len() > MAX_ICON_BYTES {
        return Err(PublishError::invalid(format!(
            "pack icon \"{raw}\" exceeds {MAX_ICON_BYTES} bytes"
        )));
    }

    let bytes = std::fs::read(&abs)
        .map_err(|e| PublishError::invalid(format!("failed to read pack icon \"{raw}\": {e}")))?;
    Ok(Some((bytes, ext)))
}
