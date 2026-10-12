//! `.spk` zip extract / create helpers (ZipSlip-safe, bounded against zip bombs).

use crate::{is_pack_archive_path, PACK_MANIFEST_FILENAME};
use std::fs::{self, File};
use std::io::{copy, Read, Write};
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

/// Default cap on archive entries (files and directories).
pub const DEFAULT_MAX_ENTRIES: usize = 10_000;
/// Default cap on total uncompressed bytes extracted from one archive (256 MiB).
pub const DEFAULT_MAX_UNCOMPRESSED_BYTES: u64 = 256 * 1024 * 1024;
/// Default cap on uncompressed:compressed ratio for the whole archive.
pub const DEFAULT_MAX_COMPRESSION_RATIO: u64 = 50;
/// The ratio check only applies once the archive expands past this size; tiny
/// archives cannot hurt, and small repetitive files compress very well.
pub const DEFAULT_RATIO_CHECK_MIN_BYTES: u64 = 8 * 1024 * 1024;

/// Bounds applied while extracting an untrusted `.spk`, to stop zip bombs from
/// exhausting disk. Pack authors are third parties, so these apply to the
/// registry's upload path and to the desktop app's install path alike.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ExtractLimits {
    /// Maximum number of archive entries.
    pub max_entries: usize,
    /// Maximum total uncompressed bytes across all entries.
    pub max_uncompressed_bytes: u64,
    /// Maximum whole-archive uncompressed:compressed ratio.
    pub max_compression_ratio: u64,
    /// Ratio is only enforced when the archive expands past this many bytes.
    pub ratio_check_min_bytes: u64,
}

impl Default for ExtractLimits {
    fn default() -> Self {
        Self {
            max_entries: DEFAULT_MAX_ENTRIES,
            max_uncompressed_bytes: DEFAULT_MAX_UNCOMPRESSED_BYTES,
            max_compression_ratio: DEFAULT_MAX_COMPRESSION_RATIO,
            ratio_check_min_bytes: DEFAULT_RATIO_CHECK_MIN_BYTES,
        }
    }
}

fn format_mib(bytes: u64) -> String {
    format!("{} MiB", bytes / (1024 * 1024))
}

/// Reject obviously hostile archives from the central directory alone, before
/// decompressing anything. Declared sizes can lie, so extraction also enforces
/// the byte budget on what is actually written.
fn check_declared_limits<R: Read + std::io::Seek>(
    archive: &mut ZipArchive<R>,
    limits: &ExtractLimits,
) -> Result<(), String> {
    if archive.len() > limits.max_entries {
        return Err(format!(
            "pack archive has too many entries ({}, max {})",
            archive.len(),
            limits.max_entries
        ));
    }

    let mut declared: u64 = 0;
    let mut compressed: u64 = 0;
    for i in 0..archive.len() {
        let entry = archive
            .by_index_raw(i)
            .map_err(|e| format!("failed to read pack archive entry {i}: {e}"))?;
        declared = declared.saturating_add(entry.size());
        compressed = compressed.saturating_add(entry.compressed_size());
    }

    if declared > limits.max_uncompressed_bytes {
        return Err(format!(
            "pack archive expands to more than {} (declares {})",
            format_mib(limits.max_uncompressed_bytes),
            format_mib(declared)
        ));
    }

    if declared > limits.ratio_check_min_bytes {
        let ratio = declared / compressed.max(1);
        if ratio > limits.max_compression_ratio {
            return Err(format!(
                "pack archive compression ratio is too high ({ratio}:1, max {}:1)",
                limits.max_compression_ratio
            ));
        }
    }

    Ok(())
}

fn extract_zip_to(archive_path: &Path, dest: &Path, limits: &ExtractLimits) -> Result<(), String> {
    let file = File::open(archive_path).map_err(|e| format!("failed to open pack archive: {e}"))?;
    let mut archive =
        ZipArchive::new(file).map_err(|e| format!("failed to read pack archive (bad zip): {e}"))?;

    check_declared_limits(&mut archive, limits)?;

    let mut remaining = limits.max_uncompressed_bytes;
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
        // Bound what is actually written, not just what the header claims.
        let name = entry.name().to_string();
        let written = copy(
            &mut (&mut entry).take(remaining.saturating_add(1)),
            &mut outfile,
        )
        .map_err(|e| format!("failed to extract {name}: {e}"))?;
        if written > remaining {
            return Err(format!(
                "pack archive expands to more than {}",
                format_mib(limits.max_uncompressed_bytes)
            ));
        }
        remaining -= written;
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

/// Extract a `.spk` (or zip-compatible) archive into a temp directory, enforcing
/// the default [`ExtractLimits`].
/// Caller must remove the returned extract dir when finished (success or failure).
pub fn extract_pack_archive(archive_path: &Path) -> Result<PathBuf, String> {
    extract_pack_archive_with_limits(archive_path, &ExtractLimits::default())
}

/// Like [`extract_pack_archive`] with explicit [`ExtractLimits`].
pub fn extract_pack_archive_with_limits(
    archive_path: &Path,
    limits: &ExtractLimits,
) -> Result<PathBuf, String> {
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

    if let Err(e) = extract_zip_to(archive_path, &extract_dir, limits) {
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

    fn write_deflated_spk(path: &Path, entries: &[(&str, Vec<u8>)]) {
        let file = File::create(path).unwrap();
        let mut zip = ZipWriter::new(file);
        let options =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        for (name, bytes) in entries {
            zip.start_file(*name, options).unwrap();
            zip.write_all(bytes).unwrap();
        }
        zip.finish().unwrap();
    }

    fn limits_dir(tag: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("spiral-spk-limits-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn default_limits_are_the_documented_values() {
        let limits = ExtractLimits::default();
        assert_eq!(limits.max_entries, 10_000);
        assert_eq!(limits.max_uncompressed_bytes, 256 * 1024 * 1024);
        assert_eq!(limits.max_compression_ratio, 50);
        assert_eq!(limits.ratio_check_min_bytes, 8 * 1024 * 1024);
    }

    #[test]
    fn rejects_too_many_entries() {
        let dir = limits_dir("entries");
        let spk = dir.join("many.spk");
        write_test_spk(&spk, &[("a", b"1"), ("b", b"2"), ("c", b"3"), ("d", b"4")]);

        let limits = ExtractLimits {
            max_entries: 3,
            ..ExtractLimits::default()
        };
        let err = extract_pack_archive_with_limits(&spk, &limits).unwrap_err();
        assert!(err.contains("too many entries"), "{err}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn accepts_exactly_the_entry_limit() {
        let dir = limits_dir("entries-ok");
        let spk = dir.join("ok.spk");
        write_test_spk(&spk, &[("a", b"1"), ("b", b"2"), ("c", b"3")]);

        let limits = ExtractLimits {
            max_entries: 3,
            ..ExtractLimits::default()
        };
        let extract = extract_pack_archive_with_limits(&spk, &limits).unwrap();
        cleanup_pack_extract_dir(&extract);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_archives_that_expand_past_the_byte_cap() {
        let dir = limits_dir("bytes");
        let spk = dir.join("big.spk");
        write_deflated_spk(
            &spk,
            &[("a.bin", vec![0u8; 2048]), ("b.bin", vec![0u8; 2048])],
        );

        let limits = ExtractLimits {
            max_uncompressed_bytes: 4000,
            ..ExtractLimits::default()
        };
        let err = extract_pack_archive_with_limits(&spk, &limits).unwrap_err();
        assert!(err.contains("expands to more than"), "{err}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn accepts_an_archive_exactly_at_the_byte_cap() {
        let dir = limits_dir("bytes-exact");
        let spk = dir.join("exact.spk");
        write_test_spk(&spk, &[("a.bin", &[7u8; 600]), ("b.bin", &[7u8; 400])]);

        let limits = ExtractLimits {
            max_uncompressed_bytes: 1000,
            ..ExtractLimits::default()
        };
        let extract = extract_pack_archive_with_limits(&spk, &limits).unwrap();
        cleanup_pack_extract_dir(&extract);

        let tight = ExtractLimits {
            max_uncompressed_bytes: 999,
            ..ExtractLimits::default()
        };
        let err = extract_pack_archive_with_limits(&spk, &tight).unwrap_err();
        assert!(err.contains("expands to more than"), "{err}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_a_suspicious_compression_ratio() {
        let dir = limits_dir("ratio");
        let spk = dir.join("bomb.spk");
        // 200 KiB of zeros deflates to a few hundred bytes.
        write_deflated_spk(&spk, &[("zeros.bin", vec![0u8; 200 * 1024])]);

        let limits = ExtractLimits {
            max_compression_ratio: 50,
            ratio_check_min_bytes: 1024,
            ..ExtractLimits::default()
        };
        let err = extract_pack_archive_with_limits(&spk, &limits).unwrap_err();
        assert!(err.contains("compression ratio"), "{err}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn ratio_is_not_enforced_for_small_archives() {
        let dir = limits_dir("ratio-small");
        let spk = dir.join("small.spk");
        // Highly compressible but tiny: well under the default 8 MiB floor.
        write_deflated_spk(&spk, &[("zeros.bin", vec![0u8; 200 * 1024])]);

        let extract = extract_pack_archive(&spk).unwrap();
        cleanup_pack_extract_dir(&extract);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_rejected_archive_leaves_no_extract_dir_behind() {
        let dir = limits_dir("cleanup");
        let spk = dir.join("many.spk");
        write_test_spk(&spk, &[("a", b"1"), ("b", b"2")]);

        let limits = ExtractLimits {
            max_entries: 1,
            ..ExtractLimits::default()
        };
        assert!(extract_pack_archive_with_limits(&spk, &limits).is_err());
        assert!(!pack_extract_temp_dir(&spk).exists());
        let _ = fs::remove_dir_all(&dir);
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
