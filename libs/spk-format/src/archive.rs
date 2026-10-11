//! `.spk` zip extract / create helpers (ZipSlip-safe).

use crate::{is_pack_archive_path, PACK_MANIFEST_FILENAME};
use std::fs::{self, File};
use std::io::{copy, Write};
use std::path::{Path, PathBuf};
use walkdir::WalkDir;
use zip::write::SimpleFileOptions;
use zip::{ZipArchive, ZipWriter};

fn pack_extract_temp_dir(archive_path: &Path) -> PathBuf {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};

    let mut hasher = DefaultHasher::new();
    archive_path.hash(&mut hasher);
    std::env::temp_dir().join(format!(
        "spiral-pack-extract-{}-{:x}",
        std::process::id(),
        hasher.finish()
    ))
}

/// Finder / macOS zip junk: `__MACOSX/` trees, AppleDouble `._*` files, `.DS_Store`.
/// Skip on extract and when building archives so Compress-built `.spk`s install clean.
fn is_apple_junk_path(path: &Path) -> bool {
    path.components().any(|c| {
        let Some(name) = c.as_os_str().to_str() else {
            return false;
        };
        name == "__MACOSX" || name == ".DS_Store" || name.starts_with("._")
    })
}

fn extract_zip_to(archive_path: &Path, dest: &Path) -> Result<(), String> {
    let file = File::open(archive_path).map_err(|e| format!("failed to open pack archive: {e}"))?;
    let mut archive =
        ZipArchive::new(file).map_err(|e| format!("failed to read pack archive (bad zip): {e}"))?;

    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("failed to read pack archive entry {i}: {e}"))?;

        let Some(entry_path) = entry.enclosed_name().map(|p| p.to_owned()) else {
            return Err(format!(
                "pack archive entry has an invalid path: {}",
                entry.name()
            ));
        };

        if is_apple_junk_path(&entry_path) {
            continue;
        }

        let outpath = dest.join(&entry_path);

        if entry.is_dir() || entry.name().ends_with('/') {
            fs::create_dir_all(&outpath)
                .map_err(|e| format!("failed to create directory {}: {e}", outpath.display()))?;
            continue;
        }

        if let Some(parent) = outpath.parent() {
            fs::create_dir_all(parent).map_err(|e| {
                format!(
                    "failed to create parent directory for {}: {e}",
                    outpath.display()
                )
            })?;
        }

        let mut outfile = File::create(&outpath)
            .map_err(|e| format!("failed to create {}: {e}", outpath.display()))?;
        copy(&mut entry, &mut outfile)
            .map_err(|e| format!("failed to extract {}: {e}", entry.name()))?;
    }

    Ok(())
}

/// Locate the pack root inside an extracted archive (`pack.json` at root or one nested folder).
pub fn find_pack_root(extract_dir: &Path) -> Result<PathBuf, String> {
    let direct = extract_dir.join(PACK_MANIFEST_FILENAME);
    if direct.is_file() {
        return Ok(extract_dir.to_path_buf());
    }

    let entries =
        fs::read_dir(extract_dir).map_err(|e| format!("failed to read extracted pack: {e}"))?;
    let mut dirs = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if is_apple_junk_path(&path) {
            continue;
        }
        if path.is_dir() {
            dirs.push(path);
        } else if path.file_name().and_then(|n| n.to_str()) == Some(PACK_MANIFEST_FILENAME) {
            return Ok(extract_dir.to_path_buf());
        }
    }

    if dirs.len() == 1 {
        let nested = &dirs[0];
        if nested.join(PACK_MANIFEST_FILENAME).is_file() {
            return Ok(nested.clone());
        }
    }

    Err(format!(
        "pack archive is missing {PACK_MANIFEST_FILENAME} at the archive root"
    ))
}

/// Extract a `.spk` (or zip-compatible) archive into a temp directory.
/// Caller must remove the returned extract dir when finished (success or failure).
pub fn extract_pack_archive(archive_path: &Path) -> Result<PathBuf, String> {
    if !archive_path.is_file() {
        return Err(format!(
            "pack archive not found: {}",
            archive_path.display()
        ));
    }
    if !is_pack_archive_path(archive_path)
        && archive_path
            .extension()
            .and_then(|e| e.to_str())
            .is_none_or(|ext| !ext.eq_ignore_ascii_case("zip"))
    {
        return Err(format!(
            "not a Spiral pack archive (.spk): {}",
            archive_path.display()
        ));
    }

    let extract_dir = pack_extract_temp_dir(archive_path);
    if extract_dir.exists() {
        fs::remove_dir_all(&extract_dir)
            .map_err(|e| format!("failed to clear previous pack extract directory: {e}"))?;
    }
    fs::create_dir_all(&extract_dir)
        .map_err(|e| format!("failed to create pack extract directory: {e}"))?;

    if let Err(e) = extract_zip_to(archive_path, &extract_dir) {
        let _ = fs::remove_dir_all(&extract_dir);
        return Err(e);
    }

    Ok(extract_dir)
}

pub fn cleanup_pack_extract_dir(extract_dir: &Path) {
    if extract_dir
        .file_name()
        .and_then(|n| n.to_str())
        .is_some_and(|n| n.starts_with("spiral-pack-extract-"))
    {
        let _ = fs::remove_dir_all(extract_dir);
    }
}

/// Zip `source_dir` contents into `dest_spk` with paths relative to the pack root.
pub fn write_pack_archive(source_dir: &Path, dest_spk: &Path) -> Result<(), String> {
    if let Some(parent) = dest_spk.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create export directory: {e}"))?;
    }

    let file = File::create(dest_spk)
        .map_err(|e| format!("failed to create pack archive {}: {e}", dest_spk.display()))?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    for entry in WalkDir::new(source_dir)
        .into_iter()
        .filter_entry(|e| {
            if e.path() == source_dir {
                return true;
            }
            match e.path().strip_prefix(source_dir) {
                Ok(rel) => !is_apple_junk_path(rel),
                Err(_) => true,
            }
        })
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        if path == source_dir {
            continue;
        }
        let rel = path
            .strip_prefix(source_dir)
            .map_err(|e| format!("failed to relativize pack path: {e}"))?;
        let name = rel.to_string_lossy().replace('\\', "/");
        if name.is_empty() {
            continue;
        }

        if path.is_dir() {
            let dir_name = if name.ends_with('/') {
                name
            } else {
                format!("{name}/")
            };
            zip.add_directory(dir_name, options)
                .map_err(|e| format!("failed to add directory to pack archive: {e}"))?;
            continue;
        }

        if !path.is_file() {
            continue;
        }

        zip.start_file(&name, options)
            .map_err(|e| format!("failed to start pack archive file {name}: {e}"))?;
        let bytes =
            fs::read(path).map_err(|e| format!("failed to read {}: {e}", path.display()))?;
        zip.write_all(&bytes)
            .map_err(|e| format!("failed to write pack archive file {name}: {e}"))?;
    }

    zip.finish()
        .map_err(|e| format!("failed to finalize pack archive: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn write_test_spk(path: &Path, entries: &[(&str, &[u8])]) {
        let file = File::create(path).unwrap();
        let mut zip = ZipWriter::new(file);
        let options = SimpleFileOptions::default();
        for (name, bytes) in entries {
            zip.start_file(*name, options).unwrap();
            zip.write_all(bytes).unwrap();
        }
        zip.finish().unwrap();
    }

    #[test]
    fn finds_pack_root_at_archive_root() {
        let dir = std::env::temp_dir().join(format!("spiral-spk-root-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let spk = dir.join("pack.spk");
        write_test_spk(
            &spk,
            &[(
                "pack.json",
                br#"{"manifestVersion":1,"packId":"t","authorId":"test","version":"1.0.0","name":"T","description":""}"#,
            )],
        );

        let extract = extract_pack_archive(&spk).unwrap();
        let root = find_pack_root(&extract).unwrap();
        assert!(root.join(PACK_MANIFEST_FILENAME).is_file());
        cleanup_pack_extract_dir(&extract);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn finds_pack_root_nested_single_folder() {
        let dir = std::env::temp_dir().join(format!("spiral-spk-nested-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let spk = dir.join("pack.spk");
        write_test_spk(
            &spk,
            &[(
                "midnight-drive/pack.json",
                br#"{"manifestVersion":1,"packId":"midnight-drive","authorId":"bryan","version":"1.0.0","name":"T","description":""}"#,
            )],
        );

        let extract = extract_pack_archive(&spk).unwrap();
        let root = find_pack_root(&extract).unwrap();
        assert!(root.ends_with("midnight-drive"));
        cleanup_pack_extract_dir(&extract);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_zip_slip() {
        let dir = std::env::temp_dir().join(format!("spiral-spk-slip-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let spk = dir.join("evil.spk");
        write_test_spk(&spk, &[("../escape.txt", b"nope")]);

        let err = extract_pack_archive(&spk).unwrap_err();
        assert!(err.contains("invalid path"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn extract_skips_macos_junk() {
        let dir = std::env::temp_dir().join(format!("spiral-spk-macosx-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let spk = dir.join("pack.spk");
        write_test_spk(
            &spk,
            &[
                (
                    "pack.json",
                    br#"{"manifestVersion":1,"packId":"t","authorId":"test","version":"1.0.0","name":"T","description":""}"#,
                ),
                ("skins/demo/skin.json", b"{}"),
                ("__MACOSX/._pack.json", b"junk"),
                ("__MACOSX/skins/._demo", b"junk"),
                ("skins/demo/._skin.json", b"appledouble"),
                (".DS_Store", b"store"),
            ],
        );

        let extract = extract_pack_archive(&spk).unwrap();
        let root = find_pack_root(&extract).unwrap();
        assert!(root.join(PACK_MANIFEST_FILENAME).is_file());
        assert!(!root.join("__MACOSX").exists());
        assert!(!root.join(".DS_Store").exists());
        assert!(!root.join("skins/demo/._skin.json").exists());
        assert!(root.join("skins/demo/skin.json").is_file());
        cleanup_pack_extract_dir(&extract);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_pack_archive_skips_macos_junk() {
        let dir =
            std::env::temp_dir().join(format!("spiral-spk-write-macosx-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let pack = dir.join("pack");
        fs::create_dir_all(pack.join("skins/demo")).unwrap();
        fs::create_dir_all(pack.join("__MACOSX/skins")).unwrap();
        fs::write(
            pack.join("pack.json"),
            br#"{"manifestVersion":1,"packId":"t","authorId":"test","version":"1.0.0","name":"T","description":""}"#,
        )
        .unwrap();
        fs::write(pack.join("skins/demo/skin.json"), b"{}").unwrap();
        fs::write(pack.join("__MACOSX/._pack.json"), b"junk").unwrap();
        fs::write(pack.join("skins/demo/._skin.json"), b"appledouble").unwrap();
        fs::write(pack.join(".DS_Store"), b"store").unwrap();

        let spk = dir.join("out.spk");
        write_pack_archive(&pack, &spk).unwrap();

        let extract = extract_pack_archive(&spk).unwrap();
        let root = find_pack_root(&extract).unwrap();
        assert!(!root.join("__MACOSX").exists());
        assert!(!root.join(".DS_Store").exists());
        assert!(!root.join("skins/demo/._skin.json").exists());
        assert!(root.join("skins/demo/skin.json").is_file());
        cleanup_pack_extract_dir(&extract);
        let _ = fs::remove_dir_all(&dir);
    }
}
