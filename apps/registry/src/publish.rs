//! Validate an uploaded item `.spk` and collect publish metadata.

use std::fs;
use std::io::Write;
use std::path::Path;

use chrono::Utc;
use sha2::{Digest, Sha256};
use spk_format::{
    cleanup_extract_dir, extract_archive, find_item_root, validate_item_dir, CHANGELOG_FILENAME,
    CHANGELOG_MAX_BYTES, README_FILENAME, README_MAX_BYTES,
};

use crate::models::ItemVersionRow;
use crate::preview::{item_storage_key, preview_storage_key, read_item_preview};

#[derive(Debug)]
pub struct ValidatedUpload {
    pub row: ItemVersionRow,
    pub bytes: Vec<u8>,
    /// Preview bytes extracted from the archive, when present.
    pub preview: Option<Vec<u8>>,
}

#[derive(Debug, thiserror::Error)]
pub enum PublishError {
    #[error("{0}")]
    Invalid(String),
}

impl PublishError {
    pub fn invalid(message: impl Into<String>) -> Self {
        Self::Invalid(message.into())
    }
}

/// Hash + extract + validate an item `.spk` body. Caller owns storing the object and inserting
/// the row. Catalog `size_bytes` is the uncompressed item-root size (not `.spk` archive length).
pub fn validate_item_bytes(bytes: &[u8]) -> Result<ValidatedUpload, PublishError> {
    let sha256 = hex::encode(Sha256::digest(bytes));

    let mut tmp = tempfile::Builder::new()
        .suffix(".spk")
        .tempfile()
        .map_err(|e| PublishError::invalid(format!("failed to create temp file: {e}")))?;
    tmp.write_all(bytes)
        .map_err(|e| PublishError::invalid(format!("failed to write temp archive: {e}")))?;
    tmp.flush()
        .map_err(|e| PublishError::invalid(format!("failed to flush temp archive: {e}")))?;

    let archive_path = tmp.path().to_path_buf();
    let extract_dir = extract_archive(&archive_path).map_err(PublishError::invalid)?;

    let result = (|| {
        let item_dir = find_item_root(&extract_dir).map_err(PublishError::invalid)?;
        let item = validate_item_dir(&item_dir).map_err(PublishError::invalid)?;

        let size_bytes = directory_size_bytes(&item_dir)? as i64;
        if size_bytes <= 0 {
            return Err(PublishError::invalid(format!(
                "{} \"{}\" has empty on-disk size",
                item.item_type, item.id
            )));
        }

        let storage_key =
            item_storage_key(&item.publisher_id, &item.item_type, &item.id, &item.version);

        // `validate_item_dir` already checked a declared preview exists and has a safe path.
        let (preview_bytes, preview_key) =
            match read_item_preview(&item_dir, item.preview.as_deref())? {
                Some((bytes, ext)) => (
                    Some(bytes),
                    Some(preview_storage_key(
                        &item.publisher_id,
                        &item.item_type,
                        &item.id,
                        &item.version,
                        &ext,
                    )),
                ),
                None => (None, None),
            };

        let readme = read_item_readme(&item_dir)?;
        let changelog = read_item_changelog(&item_dir)?;

        Ok(ValidatedUpload {
            row: ItemVersionRow {
                publisher_id: item.publisher_id,
                item_type: item.item_type,
                item_id: item.id,
                version: item.version,
                name: item.name,
                description: item.description,
                author: item.author,
                min_app_version: item.min_app_version,
                size_bytes,
                sha256,
                storage_key,
                preview_storage_key: preview_key,
                readme,
                changelog,
                published_at: Utc::now(),
                yanked_at: None,
            },
            bytes: bytes.to_vec(),
            preview: preview_bytes,
        })
    })();

    cleanup_extract_dir(&extract_dir);
    result
}

/// Total size of all regular files under `root` (does not follow symlinks).
/// Matches desktop `get_directory_size` so catalog and installed sizes agree.
pub fn directory_size_bytes(root: &Path) -> Result<u64, PublishError> {
    if !root.is_dir() {
        return Err(PublishError::invalid(format!(
            "not a directory: {}",
            root.display()
        )));
    }

    let mut total: u64 = 0;
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let entries = fs::read_dir(&dir)
            .map_err(|e| PublishError::invalid(format!("failed to read {}: {e}", dir.display())))?;
        for entry in entries {
            let entry = entry.map_err(|e| {
                PublishError::invalid(format!("failed to read entry under {}: {e}", dir.display()))
            })?;
            let path = entry.path();
            let file_type = entry.file_type().map_err(|e| {
                PublishError::invalid(format!("failed to stat {}: {e}", path.display()))
            })?;
            if file_type.is_symlink() {
                continue;
            }
            if file_type.is_dir() {
                stack.push(path);
            } else if file_type.is_file() {
                let meta = entry.metadata().map_err(|e| {
                    PublishError::invalid(format!("failed to stat {}: {e}", path.display()))
                })?;
                total = total.saturating_add(meta.len());
            }
        }
    }
    Ok(total)
}

fn read_item_readme(item_dir: &Path) -> Result<Option<String>, PublishError> {
    read_optional_item_text(item_dir, README_FILENAME, README_MAX_BYTES)
}

fn read_item_changelog(item_dir: &Path) -> Result<Option<String>, PublishError> {
    read_optional_item_text(item_dir, CHANGELOG_FILENAME, CHANGELOG_MAX_BYTES)
}

fn read_optional_item_text(
    item_dir: &Path,
    filename: &str,
    max_bytes: u64,
) -> Result<Option<String>, PublishError> {
    let path = item_dir.join(filename);
    if !path.is_file() {
        return Ok(None);
    }
    let meta = fs::metadata(&path)
        .map_err(|e| PublishError::invalid(format!("failed to stat {filename}: {e}")))?;
    if meta.len() > max_bytes {
        return Err(PublishError::invalid(format!(
            "{filename} exceeds max size of {max_bytes} bytes"
        )));
    }
    let contents = fs::read_to_string(&path)
        .map_err(|e| PublishError::invalid(format!("failed to read {filename}: {e}")))?;
    if contents.trim().is_empty() {
        return Ok(None);
    }
    Ok(Some(contents))
}
