//! Hand-seed a local SQLite DB + object store for Phase 1 read-path testing.
//!
//! Usage (from repo root, after `cargo build`):
//!
//! ```text
//! DATABASE_URL=sqlite:data/registry.db?mode=rwc \
//! STORAGE_LOCAL_PATH=data/objects \
//! cargo run --bin spk-registry-seed
//! ```

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use chrono::{Duration, Utc};
use sha2::{Digest, Sha256};
use spk_registry::config::Config;
use spk_registry::db::{self, pack_version_row};
use spk_registry::storage::build_storage;
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

fn main() -> Result<()> {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?
        .block_on(async_main())
}

async fn async_main() -> Result<()> {
    let config = Config::from_env()?;
    config.ensure_data_dirs()?;

    let pool = db::connect(&config.database_url).await?;
    let storage = build_storage(&config.storage)?;

    let fixture_dir = fixture_pack_dir()?;
    let bytes = build_spk_bytes(&fixture_dir)?;
    let sha256 = hex::encode(Sha256::digest(&bytes));
    let size_bytes = bytes.len() as i64;

    let author_id = "spiral";
    let pack_id = "demo-skin";
    let storage_key_v1 = format!("{author_id}/{pack_id}/1.0.0/pack.spk");
    let storage_key_v2 = format!("{author_id}/{pack_id}/1.1.0/pack.spk");
    let storage_key_yanked = format!("{author_id}/{pack_id}/0.9.0/pack.spk");

    storage.put(&storage_key_v1, &bytes).await?;
    storage.put(&storage_key_v2, &bytes).await?;
    storage.put(&storage_key_yanked, &bytes).await?;

    let now = Utc::now();

    // Clear prior seed rows for this pack so re-running is idempotent.
    sqlx::query("DELETE FROM pack_versions WHERE author_id = ? AND pack_id = ?")
        .bind(author_id)
        .bind(pack_id)
        .execute(&pool)
        .await?;

    db::insert_pack_version(
        &pool,
        &pack_version_row(
            author_id,
            pack_id,
            "1.0.0",
            &["skin"],
            size_bytes,
            &sha256,
            &storage_key_v1,
            now - Duration::days(14),
            None,
        ),
    )
    .await
    .map_err(|e| anyhow::anyhow!("{e}"))?;

    db::insert_pack_version(
        &pool,
        &pack_version_row(
            author_id,
            pack_id,
            "1.1.0",
            &["skin"],
            size_bytes,
            &sha256,
            &storage_key_v2,
            now - Duration::days(1),
            None,
        ),
    )
    .await
    .map_err(|e| anyhow::anyhow!("{e}"))?;

    db::insert_pack_version(
        &pool,
        &pack_version_row(
            author_id,
            pack_id,
            "0.9.0",
            &["skin"],
            size_bytes,
            &sha256,
            &storage_key_yanked,
            now - Duration::days(30),
            Some(now - Duration::days(7)),
        ),
    )
    .await
    .map_err(|e| anyhow::anyhow!("{e}"))?;

    println!("Seeded pack {author_id}/{pack_id}");
    println!("  versions: 1.0.0, 1.1.0 (published), 0.9.0 (yanked)");
    println!("  sha256:   {sha256}");
    println!("  size:     {size_bytes} bytes");
    println!("  database: {}", config.database_url);
    println!();
    println!("Try:");
    println!("  curl -s http://127.0.0.1:8787/v1/meta | jq");
    println!("  curl -s http://127.0.0.1:8787/v1/packs | jq");
    println!("  curl -s http://127.0.0.1:8787/v1/packs/{author_id}/{pack_id} | jq");
    println!(
        "  curl -OJ http://127.0.0.1:8787/v1/packs/{author_id}/{pack_id}/versions/latest/download"
    );

    Ok(())
}

fn fixture_pack_dir() -> Result<PathBuf> {
    let candidates = [
        PathBuf::from("fixtures/demo-skin"),
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fixtures/demo-skin"),
    ];
    for path in candidates {
        if path.join("pack.json").is_file() {
            return Ok(path);
        }
    }
    bail!("fixtures/demo-skin/pack.json not found; run from the repo root")
}

fn build_spk_bytes(pack_dir: &Path) -> Result<Vec<u8>> {
    let mut cursor = std::io::Cursor::new(Vec::new());
    {
        let mut zip = ZipWriter::new(&mut cursor);
        let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
        add_dir_to_zip(&mut zip, pack_dir, Path::new(""), options)?;
        zip.finish().context("finish zip")?;
    }
    Ok(cursor.into_inner())
}

fn add_dir_to_zip(
    zip: &mut ZipWriter<&mut std::io::Cursor<Vec<u8>>>,
    abs: &Path,
    rel: &Path,
    options: SimpleFileOptions,
) -> Result<()> {
    for entry in fs::read_dir(abs).with_context(|| format!("read {}", abs.display()))? {
        let entry = entry?;
        let path = entry.path();
        let name = entry.file_name();
        let child_rel = rel.join(&name);
        let zip_name = child_rel
            .to_str()
            .with_context(|| format!("non-utf8 path {}", child_rel.display()))?
            .replace('\\', "/");

        if path.is_dir() {
            zip.add_directory(format!("{zip_name}/"), options)?;
            add_dir_to_zip(zip, &path, &child_rel, options)?;
        } else {
            let data = fs::read(&path).with_context(|| format!("read {}", path.display()))?;
            zip.start_file(zip_name, options)?;
            zip.write_all(&data)?;
        }
    }
    Ok(())
}
