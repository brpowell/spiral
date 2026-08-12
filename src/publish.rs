//! Validate an uploaded `.spk` and collect publish metadata.

use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use chrono::Utc;
use sha2::{Digest, Sha256};
use spk_format::{
    cleanup_pack_extract_dir, contribution_id_from_manifest_json, effective_contribution_id,
    extract_pack_archive, find_pack_root, get_contribution_type_handler, parse_pack_manifest_json,
    resolve_preview_file, validate_renderer_contribution_at, validate_skin_contribution_at,
    validate_theme_contribution_at, validate_visualizer_contribution_at, PackManifest,
    CONTRIBUTION_TYPE_FOLDERS, PACK_MANIFEST_FILENAME, PACK_README_FILENAME, PACK_README_MAX_BYTES,
};

use crate::models::{ContributionSummary, PackVersionRow};
use crate::preview::{pack_storage_key, preview_storage_key, read_pack_preview};

#[derive(Debug)]
pub struct ValidatedUpload {
    pub row: PackVersionRow,
    pub bytes: Vec<u8>,
    /// Pack preview bytes extracted from the archive, when present.
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
        let (pack, contribution_summaries) = validate_pack_for_publish(&pack_dir)?;
        if contribution_summaries.is_empty() {
            return Err(PublishError::invalid(format!(
                "pack \"{}\" has no contributions",
                pack.pack_id
            )));
        }

        let storage_key = pack_storage_key(&pack.author_id, &pack.pack_id, &pack.version);
        let mut types: Vec<String> = contribution_summaries
            .iter()
            .map(|c| c.r#type.clone())
            .collect();
        types.sort();
        types.dedup();
        let types_json = serde_json::to_string(&types)
            .map_err(|e| PublishError::invalid(format!("serialize contribution types: {e}")))?;
        let contributions_json = serde_json::to_string(&contribution_summaries).map_err(|e| {
            PublishError::invalid(format!("serialize contributions: {e}"))
        })?;

        let preview_rel = resolve_publish_preview_rel(&pack_dir, &pack)?;
        let preview_asset = read_pack_preview(&pack_dir, preview_rel.as_deref())?;
        let (preview_bytes, preview_key) = match preview_asset {
            Some((bytes, ext)) => (
                Some(bytes),
                Some(preview_storage_key(
                    &pack.author_id,
                    &pack.pack_id,
                    &pack.version,
                    &ext,
                )),
            ),
            None => (None, None),
        };

        let readme = read_pack_readme(&pack_dir)?;

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
                preview_storage_key: preview_key,
                name: pack.name,
                description: pack.description,
                readme,
                contributions: contributions_json,
                published_at: Utc::now(),
                yanked_at: None,
            },
            bytes: bytes.to_vec(),
            preview: preview_bytes,
        })
    })();

    cleanup_pack_extract_dir(&extract_dir);
    result
}

fn validate_pack_for_publish(
    pack_dir: &Path,
) -> Result<(PackManifest, Vec<ContributionSummary>), PublishError> {
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
    let mut summaries = Vec::with_capacity(contributions.len());
    for (contrib_type, rel_path, manifest, local_id) in &contributions {
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

        let (peeked_name, peeked_author) = peek_contribution_fields(manifest);
        let name = peeked_name.unwrap_or_else(|| local_id.clone());
        let author = peeked_author.unwrap_or_default();
        let effective_id = effective_contribution_id(
            &pack.author_id,
            &pack.pack_id,
            contrib_type,
            local_id,
        );
        summaries.push(ContributionSummary {
            r#type: contrib_type.clone(),
            local_id: local_id.clone(),
            effective_id,
            name,
            author,
        });
    }

    Ok((pack, summaries))
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

fn peek_contribution_fields(manifest_path: &Path) -> (Option<String>, Option<String>) {
    let Ok(contents) = fs::read_to_string(manifest_path) else {
        return (None, None);
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&contents) else {
        return (None, None);
    };
    let peek = |key: &str| {
        value
            .get(key)
            .and_then(|n| n.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
    };
    (peek("name"), peek("author"))
}

fn read_pack_readme(pack_dir: &Path) -> Result<Option<String>, PublishError> {
    let path = pack_dir.join(PACK_README_FILENAME);
    if !path.is_file() {
        return Ok(None);
    }
    let meta = fs::metadata(&path).map_err(|e| {
        PublishError::invalid(format!("failed to stat {PACK_README_FILENAME}: {e}"))
    })?;
    if meta.len() > PACK_README_MAX_BYTES {
        return Err(PublishError::invalid(format!(
            "{PACK_README_FILENAME} exceeds max size of {PACK_README_MAX_BYTES} bytes"
        )));
    }
    let contents = fs::read_to_string(&path).map_err(|e| {
        PublishError::invalid(format!("failed to read {PACK_README_FILENAME}: {e}"))
    })?;
    if contents.trim().is_empty() {
        return Ok(None);
    }
    Ok(Some(contents))
}

fn peek_contribution_preview(manifest_path: &Path) -> Option<String> {
    let contents = fs::read_to_string(manifest_path).ok()?;
    let value: serde_json::Value = serde_json::from_str(&contents).ok()?;
    value
        .get("preview")
        .and_then(|n| n.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// Explicit `pack.json` preview, else first contribution preview in canonical folder order.
fn resolve_publish_preview_rel(
    pack_dir: &Path,
    pack: &PackManifest,
) -> Result<Option<String>, PublishError> {
    if let Some(preview) = pack
        .preview
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        return Ok(Some(preview.to_string()));
    }

    for &(folder, _contrib_type, manifest_filename) in CONTRIBUTION_TYPE_FOLDERS {
        let type_root = pack_dir.join(folder);
        if !type_root.is_dir() {
            continue;
        }
        let Ok(entries) = fs::read_dir(&type_root) else {
            continue;
        };
        for entry in entries.flatten() {
            let contribution_dir = entry.path();
            if !contribution_dir.is_dir() {
                continue;
            }
            let contrib_manifest = contribution_dir.join(manifest_filename);
            if !contrib_manifest.is_file() {
                continue;
            }
            let explicit = peek_contribution_preview(&contrib_manifest);
            let Some(abs) = resolve_preview_file(&contribution_dir, explicit.as_deref()) else {
                continue;
            };
            let rel = abs
                .strip_prefix(pack_dir)
                .map(|p| p.to_string_lossy().replace('\\', "/"))
                .unwrap_or_else(|_| abs.to_string_lossy().replace('\\', "/"));
            return Ok(Some(rel));
        }
    }
    Ok(None)
}

fn collect_contributions(
    pack_dir: &Path,
    pack: &PackManifest,
) -> Result<Vec<(String, String, PathBuf, String)>, PublishError> {
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
            out.push((
                contrib_type.to_string(),
                rel,
                contrib_manifest,
                local_id,
            ));
        }
    }

    Ok(out)
}
