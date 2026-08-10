//! Validate an uploaded `.spk` and collect publish metadata.

use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use chrono::Utc;
use sha2::{Digest, Sha256};
use spk_format::{
    cleanup_pack_extract_dir, contribution_id_from_manifest_json, extract_pack_archive,
    find_pack_root, get_contribution_type_handler, parse_pack_manifest_json,
    validate_renderer_contribution_at, validate_skin_contribution_at,
    validate_theme_contribution_at, validate_visualizer_contribution_at, PackManifest,
    CONTRIBUTION_TYPE_FOLDERS, PACK_MANIFEST_FILENAME,
};

use crate::icons::{icon_storage_key, pack_storage_key, read_pack_icon};
use crate::models::PackVersionRow;

#[derive(Debug)]
pub struct ValidatedUpload {
    pub row: PackVersionRow,
    pub bytes: Vec<u8>,
    /// Pack icon bytes extracted from the archive, if `pack.json` declared one.
    pub icon: Option<Vec<u8>>,
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

/// Hash + extract + validate a `.spk` body. Caller owns storing the object and inserting the row.
pub fn validate_spk_bytes(bytes: &[u8]) -> Result<ValidatedUpload, PublishError> {
    let sha256 = hex::encode(Sha256::digest(bytes));
    let size_bytes = bytes.len() as i64;

    let mut tmp = tempfile::Builder::new()
        .suffix(".spk")
        .tempfile()
        .map_err(|e| PublishError::invalid(format!("failed to create temp file: {e}")))?;
    tmp.write_all(bytes)
        .map_err(|e| PublishError::invalid(format!("failed to write temp archive: {e}")))?;
    tmp.flush()
        .map_err(|e| PublishError::invalid(format!("failed to flush temp archive: {e}")))?;

    let archive_path = tmp.path().to_path_buf();
    let extract_dir =
        extract_pack_archive(&archive_path).map_err(PublishError::invalid)?;

    let result = (|| {
        let pack_dir = find_pack_root(&extract_dir).map_err(PublishError::invalid)?;
        let (pack, contribution_types) = validate_pack_for_publish(&pack_dir)?;
        if contribution_types.is_empty() {
            return Err(PublishError::invalid(format!(
                "pack \"{}\" has no contributions",
                pack.pack_id
            )));
        }

        let storage_key = pack_storage_key(&pack.author_id, &pack.pack_id, &pack.version);
        let types_json = serde_json::to_string(&contribution_types)
            .map_err(|e| PublishError::invalid(format!("serialize contribution types: {e}")))?;

        let icon = read_pack_icon(&pack_dir, pack.icon.as_deref())?;
        let (icon_bytes, icon_storage_key) = match icon {
            Some((bytes, ext)) => (
                Some(bytes),
                Some(icon_storage_key(
                    &pack.author_id,
                    &pack.pack_id,
                    &pack.version,
                    &ext,
                )),
            ),
            None => (None, None),
        };

        Ok(ValidatedUpload {
            row: PackVersionRow {
                author_id: pack.author_id,
                pack_id: pack.pack_id,
                version: pack.version,
                min_app_version: pack.min_app_version,
                contribution_types: types_json,
                size_bytes,
                sha256,
                storage_key,
                icon_storage_key,
                published_at: Utc::now(),
                yanked_at: None,
            },
            bytes: bytes.to_vec(),
            icon: icon_bytes,
        })
    })();

    cleanup_pack_extract_dir(&extract_dir);
    result
}

fn validate_pack_for_publish(
    pack_dir: &Path,
) -> Result<(PackManifest, Vec<String>), PublishError> {
    let manifest_path = pack_dir.join(PACK_MANIFEST_FILENAME);
    if !manifest_path.is_file() {
        return Err(PublishError::invalid(format!(
            "pack is missing {PACK_MANIFEST_FILENAME}"
        )));
    }

    let contents = fs::read_to_string(&manifest_path).map_err(|e| {
        PublishError::invalid(format!("failed to read {PACK_MANIFEST_FILENAME}: {e}"))
    })?;
    let pack =
        parse_pack_manifest_json(&contents).map_err(|e| PublishError::invalid(e.to_string()))?;

    let contributions = collect_contributions(pack_dir, &pack)?;
    for (contrib_type, rel_path, manifest) in &contributions {
        if get_contribution_type_handler(contrib_type).is_none() {
            return Err(PublishError::invalid(format!(
                "pack \"{}\": unknown contribution type \"{contrib_type}\" at {rel_path}",
                pack.pack_id
            )));
        }
        validate_contribution(contrib_type, manifest).map_err(|e| {
            PublishError::invalid(format!(
                "pack \"{}\": invalid {contrib_type} contribution at {rel_path}: {e}",
                pack.pack_id
            ))
        })?;
    }

    let mut types: Vec<String> = contributions.into_iter().map(|(ty, _, _)| ty).collect();
    types.sort();
    types.dedup();
    Ok((pack, types))
}

fn validate_contribution(contrib_type: &str, manifest_path: &Path) -> Result<(), String> {
    match contrib_type {
        "theme" => validate_theme_contribution_at(manifest_path),
        "skin" => validate_skin_contribution_at(manifest_path),
        "visualizer" => validate_visualizer_contribution_at(manifest_path),
        "renderer" => validate_renderer_contribution_at(manifest_path),
        other => Err(format!("unknown contribution type \"{other}\"")),
    }
}

fn collect_contributions(
    pack_dir: &Path,
    pack: &PackManifest,
) -> Result<Vec<(String, String, PathBuf)>, PublishError> {
    let mut out = Vec::new();
    let mut seen_type_local_ids: HashMap<String, PathBuf> = HashMap::new();

    for &(folder, contrib_type, manifest_filename) in CONTRIBUTION_TYPE_FOLDERS {
        let type_root = pack_dir.join(folder);
        if !type_root.is_dir() {
            continue;
        }
        let entries = fs::read_dir(&type_root).map_err(|e| {
            PublishError::invalid(format!(
                "pack \"{}\": could not read {folder}/: {e}",
                pack.pack_id
            ))
        })?;
        for entry in entries.flatten() {
            let contribution_dir = entry.path();
            if !contribution_dir.is_dir() {
                continue;
            }
            let contrib_manifest = contribution_dir.join(manifest_filename);
            if !contrib_manifest.is_file() {
                continue;
            }
            let contents = fs::read_to_string(&contrib_manifest).map_err(|e| {
                PublishError::invalid(format!(
                    "pack \"{}\": could not read {}: {e}",
                    pack.pack_id,
                    contrib_manifest.display()
                ))
            })?;
            let local_id = contribution_id_from_manifest_json(&contents).map_err(|e| {
                PublishError::invalid(format!(
                    "pack \"{}\": {}: {e}",
                    pack.pack_id,
                    contrib_manifest.display()
                ))
            })?;
            let type_local_key = format!("{contrib_type}:{local_id}");
            if let Some(existing) = seen_type_local_ids.get(&type_local_key) {
                return Err(PublishError::invalid(format!(
                    "pack \"{}\": duplicate {contrib_type} contribution id \"{local_id}\" at {} and {}",
                    pack.pack_id,
                    existing.display(),
                    contrib_manifest.display()
                )));
            }
            seen_type_local_ids.insert(type_local_key, contrib_manifest.clone());
            let rel = contrib_manifest
                .strip_prefix(pack_dir)
                .map(|p| p.to_string_lossy().replace('\\', "/"))
                .unwrap_or_else(|_| contrib_manifest.to_string_lossy().into_owned());
            out.push((contrib_type.to_string(), rel, contrib_manifest));
        }
    }

    Ok(out)
}
