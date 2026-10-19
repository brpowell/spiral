//! Seed a local SQLite DB + object store with demo items for read-path testing.
//!
//! Usage (from `apps/registry`; the defaults write to `./data`):
//!
//! ```text
//! cargo run --bin spk-registry-seed
//! ```
//!
//! Override `DATABASE_URL` / `STORAGE_LOCAL_PATH` to seed somewhere else. Each fixture under
//! `fixtures/items/` is zipped, run through the same validation as a real upload, and stored
//! under every version listed below.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use chrono::{Duration, Utc};
use spk_format::CONTRIBUTION_TYPE_FOLDERS;
use spk_registry::config::Config;
use spk_registry::db;
use spk_registry::publish::validate_item_bytes;
use spk_registry::storage::build_storage;
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

/// `(fixture dir, [(version, published N days ago, yanked N days ago)])`.
type SeedPlan = (&'static str, &'static [(&'static str, i64, Option<i64>)]);

const PLAN: &[SeedPlan] = &[
    (
        "demo-theme",
        &[
            ("0.9.0", 30, Some(7)),
            ("1.0.0", 14, None),
            ("1.1.0", 1, None),
        ],
    ),
    ("mini-skin", &[("1.0.0", 10, None)]),
    ("demo-viz", &[("1.0.0", 5, None)]),
    ("demo-sound", &[("1.0.0", 2, None)]),
];

fn main() -> Result<()> {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?
        .block_on(async_main())
}

async fn async_main() -> Result<()> {
    let config = Config::from_env()?;
    config.ensure_data_dirs()?;

    let store = db::connect(&config.database_url).await?;
    let storage = build_storage(&config.storage)?;
    let fixtures = fixtures_dir()?;
    let now = Utc::now();

    println!("Seeded items:");
    for (fixture, versions) in PLAN {
        let dir = fixtures.join(fixture);
        let mut cleared = false;
        for &(version, published_days_ago, yanked_days_ago) in *versions {
            let bytes = build_item_spk(&dir, version)?;
            let mut upload = validate_item_bytes(&bytes)
                .map_err(|e| anyhow::anyhow!("fixture {fixture}@{version}: {e}"))?;

            // Clear prior seed rows for this item once so re-running is idempotent.
            if !cleared {
                let row = &upload.row;
                for old in store
                    .delete_item_versions(&row.publisher_id, &row.item_type, &row.item_id, None)
                    .await?
                {
                    let _ = storage.delete(&old.storage_key).await;
                    if let Some(preview) = &old.preview_storage_key {
                        let _ = storage.delete(preview).await;
                    }
                }
                cleared = true;
            }

            upload.row.published_at = now - Duration::days(published_days_ago);
            upload.row.yanked_at = yanked_days_ago.map(|d| now - Duration::days(d));

            storage.put(&upload.row.storage_key, &upload.bytes).await?;
            if let (Some(key), Some(preview)) = (&upload.row.preview_storage_key, &upload.preview) {
                storage.put(key, preview).await?;
            }
            store
                .insert_item_version(&upload.row)
                .await
                .map_err(|e| anyhow::anyhow!("{e}"))?;

            let row = &upload.row;
            println!(
                "  {}.{}.{} {}{}",
                row.publisher_id,
                row.item_type,
                row.item_id,
                row.version,
                if row.yanked_at.is_some() {
                    " (yanked)"
                } else {
                    ""
                }
            );
        }
    }
    println!("  database: {}", config.database_url);
    println!();
    println!("Try:");
    println!("  curl -s http://127.0.0.1:8787/v1/meta | jq");
    println!("  curl -s 'http://127.0.0.1:8787/v1/items?type=theme' | jq");
    println!("  curl -s http://127.0.0.1:8787/v1/items/spiral/theme/demo-theme | jq");
    println!(
        "  curl -OJ http://127.0.0.1:8787/v1/items/spiral/theme/demo-theme/versions/latest/download"
    );

    Ok(())
}

fn fixtures_dir() -> Result<PathBuf> {
    let candidates = [
        PathBuf::from("fixtures/items"),
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fixtures/items"),
    ];
    for path in candidates {
        if path.is_dir() {
            return Ok(path);
        }
    }
    bail!("fixtures/items not found; run from apps/registry")
}

/// Zip an item directory, rewriting the manifest's `version`.
fn build_item_spk(item_dir: &Path, version: &str) -> Result<Vec<u8>> {
    let mut cursor = std::io::Cursor::new(Vec::new());
    {
        let mut zip = ZipWriter::new(&mut cursor);
        let options =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
        add_dir_to_zip(&mut zip, item_dir, Path::new(""), options, version)?;
        zip.finish().context("finish zip")?;
    }
    Ok(cursor.into_inner())
}

fn is_item_manifest(rel: &Path) -> bool {
    rel.parent().is_some_and(|p| p.as_os_str().is_empty())
        && rel
            .file_name()
            .and_then(|n| n.to_str())
            .is_some_and(|name| CONTRIBUTION_TYPE_FOLDERS.iter().any(|(_, _, f)| *f == name))
}

fn add_dir_to_zip(
    zip: &mut ZipWriter<&mut std::io::Cursor<Vec<u8>>>,
    abs: &Path,
    rel: &Path,
    options: SimpleFileOptions,
    version: &str,
) -> Result<()> {
    for entry in fs::read_dir(abs).with_context(|| format!("read {}", abs.display()))? {
        let entry = entry?;
        let path = entry.path();
        let child_rel = rel.join(entry.file_name());
        let zip_name = child_rel
            .to_str()
            .with_context(|| format!("non-utf8 path {}", child_rel.display()))?
            .replace('\\', "/");

        if path.is_dir() {
            zip.add_directory(format!("{zip_name}/"), options)?;
            add_dir_to_zip(zip, &path, &child_rel, options, version)?;
        } else {
            let mut data = fs::read(&path).with_context(|| format!("read {}", path.display()))?;
            if is_item_manifest(&child_rel) {
                let mut manifest: serde_json::Value = serde_json::from_slice(&data)
                    .with_context(|| format!("parse {}", path.display()))?;
                manifest["version"] = serde_json::Value::String(version.to_string());
                data = serde_json::to_vec_pretty(&manifest)?;
            }
            zip.start_file(zip_name, options)?;
            zip.write_all(&data)?;
        }
    }
    Ok(())
}
