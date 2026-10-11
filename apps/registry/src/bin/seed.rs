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
use spk_format::{
    contribution_id_from_manifest_json, effective_contribution_id, parse_pack_manifest_json,
    CONTRIBUTION_TYPE_FOLDERS, PACK_CHANGELOG_FILENAME, PACK_MANIFEST_FILENAME,
    PACK_README_FILENAME,
};
use spk_registry::config::Config;
use spk_registry::db::{self, pack_version_row};
use spk_registry::models::ContributionSummary;
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
    let browse = browse_metadata_from_pack_dir(&fixture_dir)?;
    let bytes = build_spk_bytes(&fixture_dir)?;
    let sha256 = hex::encode(Sha256::digest(&bytes));
    let size_bytes = spk_registry::publish::directory_size_bytes(&fixture_dir)
        .map_err(|e| anyhow::anyhow!("{e}"))? as i64;

    let author_id = browse.author_id.as_str();
    let pack_id = browse.pack_id.as_str();
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

    let types: Vec<&str> = browse
        .contribution_types
        .iter()
        .map(String::as_str)
        .collect();
    let contributions_json = serde_json::to_string(&browse.contributions)?;

    for (version, storage_key, published_at, yanked_at) in [
        (
            "1.0.0",
            storage_key_v1.as_str(),
            now - Duration::days(14),
            None,
        ),
        (
            "1.1.0",
            storage_key_v2.as_str(),
            now - Duration::days(1),
            None,
        ),
        (
            "0.9.0",
            storage_key_yanked.as_str(),
            now - Duration::days(30),
            Some(now - Duration::days(7)),
        ),
    ] {
        let mut row = pack_version_row(
            author_id,
            pack_id,
            version,
            &types,
            size_bytes,
            &sha256,
            storage_key,
            published_at,
            yanked_at,
        );
        row.name = browse.name.clone();
        row.description = browse.description.clone();
        row.readme = browse.readme.clone();
        row.changelog = browse.changelog.clone();
        row.contributions = contributions_json.clone();
        db::insert_pack_version(&pool, &row)
            .await
            .map_err(|e| anyhow::anyhow!("{e}"))?;
    }

    println!("Seeded pack {author_id}/{pack_id}");
    println!("  name:     {}", browse.name);
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

struct BrowseMetadata {
    author_id: String,
    pack_id: String,
    name: String,
    description: String,
    readme: Option<String>,
    changelog: Option<String>,
    contribution_types: Vec<String>,
    contributions: Vec<ContributionSummary>,
}

/// Lightweight pack.json + contribution peek for seeding (fixture may not pass full validators).
fn browse_metadata_from_pack_dir(pack_dir: &Path) -> Result<BrowseMetadata> {
    let contents =
        fs::read_to_string(pack_dir.join(PACK_MANIFEST_FILENAME)).context("read pack.json")?;
    let pack = parse_pack_manifest_json(&contents).map_err(|e| anyhow::anyhow!("{e}"))?;

    let mut contributions = Vec::new();
    let mut types = Vec::new();
    for &(folder, contrib_type, manifest_filename) in CONTRIBUTION_TYPE_FOLDERS {
        let type_root = pack_dir.join(folder);
        if !type_root.is_dir() {
            continue;
        }
        for entry in fs::read_dir(&type_root)?.flatten() {
            let contribution_dir = entry.path();
            if !contribution_dir.is_dir() {
                continue;
            }
            let manifest_path = contribution_dir.join(manifest_filename);
            if !manifest_path.is_file() {
                continue;
            }
            let text = fs::read_to_string(&manifest_path)?;
            let local_id =
                contribution_id_from_manifest_json(&text).map_err(|e| anyhow::anyhow!("{e}"))?;
            let value: serde_json::Value = serde_json::from_str(&text).unwrap_or_default();
            let peek = |key: &str| {
                value
                    .get(key)
                    .and_then(|n| n.as_str())
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .map(str::to_string)
            };
            let name = peek("name").unwrap_or_else(|| local_id.clone());
            let author = peek("author").unwrap_or_default();
            let effective_id =
                effective_contribution_id(&pack.author_id, &pack.pack_id, contrib_type, &local_id);
            contributions.push(ContributionSummary {
                r#type: contrib_type.to_string(),
                local_id,
                effective_id,
                name,
                author,
            });
            types.push(contrib_type.to_string());
        }
    }
    types.sort();
    types.dedup();

    let readme_path = pack_dir.join(PACK_README_FILENAME);
    let readme = if readme_path.is_file() {
        let text = fs::read_to_string(&readme_path)?;
        if text.trim().is_empty() {
            None
        } else {
            Some(text)
        }
    } else {
        None
    };

    let changelog_path = pack_dir.join(PACK_CHANGELOG_FILENAME);
    let changelog = if changelog_path.is_file() {
        let text = fs::read_to_string(&changelog_path)?;
        if text.trim().is_empty() {
            None
        } else {
            Some(text)
        }
    } else {
        None
    };

    Ok(BrowseMetadata {
        author_id: pack.author_id,
        pack_id: pack.pack_id,
        name: pack.name,
        description: pack.description,
        readme,
        changelog,
        contribution_types: types,
        contributions,
    })
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
        let options =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
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
