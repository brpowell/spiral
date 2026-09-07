use crate::commands::library::DbState;
use crate::db;
use crate::file_scan::scan_folder_paths;
use crate::library_organize;
use crate::library_paths;
use crate::lyrics_normalize;
use crate::metadata_reader;
use crate::rating_sync::RatingSync;
use crate::settings::{self, LibrarySettingsPatch, LibrarySettingsResponse, DATABASE_FILE_NAME};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LibraryRelocateMode {
    Move,
    Switch,
    Fresh,
    FreshImport,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryDestinationInfo {
    pub path: String,
    pub has_database: bool,
    pub audio_file_count: u32,
    pub blocked_reason: Option<String>,
}

fn normalize_path(path: &str) -> PathBuf {
    let trimmed = path.trim();
    PathBuf::from(trimmed)
}

fn try_canonicalize(path: &Path) -> PathBuf {
    path.canonicalize().unwrap_or_else(|_| path.to_path_buf())
}

fn paths_equal(a: &Path, b: &Path) -> bool {
    if a == b {
        return true;
    }
    match (a.canonicalize(), b.canonicalize()) {
        (Ok(ac), Ok(bc)) => ac == bc,
        _ => a == b,
    }
}

fn is_nested(child: &Path, parent: &Path) -> bool {
    let child = try_canonicalize(child);
    let parent = try_canonicalize(parent);
    child != parent && child.starts_with(&parent)
}

fn validate_destination(current_root: &Path, dest: &Path) -> Result<(), String> {
    if dest.as_os_str().is_empty() {
        return Err("Library folder path is empty".into());
    }
    if paths_equal(current_root, dest) {
        return Err("That folder is already your library location".into());
    }
    if is_nested(dest, current_root) {
        return Err(
            "Choose a folder outside your current library — nested locations aren't supported"
                .into(),
        );
    }
    if is_nested(current_root, dest) {
        return Err("Choose a folder that isn't an ancestor of your current library".into());
    }
    Ok(())
}

/// Count audio files under `root` (recursive). Includes `Tracks/` when present.
fn count_audio_unique(root: &Path) -> u32 {
    if !root.is_dir() {
        return 0;
    }
    scan_folder_paths(&root.to_string_lossy())
        .map(|paths| paths.len() as u32)
        .unwrap_or(0)
}

pub fn inspect_library_destination(
    app: &AppHandle,
    path: &str,
) -> Result<LibraryDestinationInfo, String> {
    let dest = normalize_path(path);
    let current = settings::resolved_library_settings(app);
    let current_root = PathBuf::from(&current.library_root);

    let blocked_reason = validate_destination(&current_root, &dest).err();

    let has_database = dest.join(DATABASE_FILE_NAME).is_file();
    let audio_file_count = if dest.is_dir() {
        count_audio_unique(&dest)
    } else {
        0
    };

    Ok(LibraryDestinationInfo {
        path: dest.to_string_lossy().into_owned(),
        has_database,
        audio_file_count,
        blocked_reason,
    })
}

fn reopen_db(state: &DbState, path: &Path) -> Result<(), String> {
    let mut guard = state
        .0
        .lock()
        .map_err(|e| format!("database lock poisoned: {e}"))?;
    *guard = db::open(path).map_err(|e| format!("failed to open library database: {e}"))?;
    Ok(())
}

fn release_db_to_memory(state: &DbState) -> Result<(), String> {
    let mut guard = state
        .0
        .lock()
        .map_err(|e| format!("database lock poisoned: {e}"))?;
    *guard =
        Connection::open_in_memory().map_err(|e| format!("failed to release database: {e}"))?;
    Ok(())
}

fn copy_dir_recursive(from: &Path, to: &Path) -> Result<(), String> {
    fs::create_dir_all(to)
        .map_err(|e| format!("failed to create directory {}: {e}", to.display()))?;
    for entry in
        fs::read_dir(from).map_err(|e| format!("failed to read {}: {e}", from.display()))?
    {
        let entry = entry.map_err(|e| e.to_string())?;
        let src = entry.path();
        let dest = to.join(entry.file_name());
        let file_type = entry
            .file_type()
            .map_err(|e| format!("failed to read file type: {e}"))?;
        if file_type.is_dir() {
            copy_dir_recursive(&src, &dest)?;
        } else if file_type.is_file() {
            if let Some(parent) = dest.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            fs::copy(&src, &dest).map_err(|e| {
                format!("failed to copy {} → {}: {e}", src.display(), dest.display())
            })?;
        }
    }
    Ok(())
}

fn remove_path_best_effort(path: &Path) {
    if path.is_dir() {
        let _ = fs::remove_dir_all(path);
    } else if path.is_file() {
        let _ = fs::remove_file(path);
    }
}

/// Move or copy `from` to `to`. Prefers rename (same volume); falls back to
/// copy + remove source.
fn relocate_entry(from: &Path, to: &Path) -> Result<(), String> {
    if !from.exists() {
        return Ok(());
    }
    if to.exists() {
        return Err(format!("Destination already exists: {}", to.display()));
    }
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create {}: {e}", parent.display()))?;
    }
    match fs::rename(from, to) {
        Ok(()) => Ok(()),
        Err(_) => {
            if from.is_dir() {
                copy_dir_recursive(from, to)?;
            } else {
                fs::copy(from, to).map_err(|e| {
                    format!("failed to copy {} → {}: {e}", from.display(), to.display())
                })?;
            }
            remove_path_best_effort(from);
            Ok(())
        }
    }
}

pub(crate) fn rewrite_path_prefix(
    file_path: &str,
    old_media: &Path,
    new_media: &Path,
) -> Option<String> {
    let old_path = Path::new(file_path);
    if !library_organize::is_under_media_folder(old_path, old_media) {
        return None;
    }

    // Prefer string prefix replacement so stored path separators are preserved
    // (Path::join on Windows injects `\` even when rewriting `/`-style paths).
    let old_prefix = old_media.to_string_lossy();
    if let Some(suffix) = file_path.strip_prefix(old_prefix.as_ref()) {
        let trimmed = suffix.trim_start_matches(['/', '\\']);
        if trimmed.is_empty() {
            return None;
        }
        let new_prefix = new_media.to_string_lossy();
        let sep = if suffix.starts_with('\\') { "\\" } else { "/" };
        return Some(format!("{new_prefix}{sep}{trimmed}"));
    }

    // Fallback when canonicalize differs from the stored absolute string.
    if let Ok(rel) = old_path.strip_prefix(old_media) {
        if rel.as_os_str().is_empty() {
            return None;
        }
        let joined = new_media.join(rel).to_string_lossy().into_owned();
        if file_path.contains('/') && !file_path.contains('\\') {
            return Some(joined.replace('\\', "/"));
        }
        return Some(joined);
    }

    None
}

pub(crate) fn rewrite_media_paths(
    app: &AppHandle,
    conn: &Connection,
    old_media: &Path,
    new_media: &Path,
) -> Result<(), String> {
    let app_data = settings::app_data_dir(app)?;
    let tracks = db::get_all_tracks(conn).map_err(|e| e.to_string())?;

    for track in tracks {
        let Some(new_path_str) = rewrite_path_prefix(&track.file_path, old_media, new_media) else {
            continue;
        };
        if new_path_str == track.file_path {
            continue;
        }

        // Library-relative Artwork/ paths stay valid across Tracks/ relocate.
        let new_art = match track.art_path.as_deref() {
            Some(p) if p.starts_with("Artwork/") || p.starts_with("Artwork\\") => {
                Some(p.to_string())
            }
            None => None,
            Some(_) => library_organize::migrate_art_cache(
                &app_data,
                &track.file_path,
                &new_path_str,
                track.art_path.as_deref(),
            )?,
        };

        conn.execute(
            "UPDATE tracks SET file_path = ?1, art_path = ?2 WHERE id = ?3",
            rusqlite::params![new_path_str, new_art, track.id],
        )
        .map_err(|e| format!("failed to rewrite track path: {e}"))?;
    }

    Ok(())
}

fn apply_library_root(app: &AppHandle, new_root: &str) -> Result<LibrarySettingsResponse, String> {
    settings::merge_library_settings(
        app,
        LibrarySettingsPatch {
            library_root: Some(new_root.to_string()),
            ..Default::default()
        },
    )
}

fn import_audio_as_reference(app: &AppHandle, state: &DbState, root: &Path) -> Result<u32, String> {
    let paths = scan_folder_paths(&root.to_string_lossy())?;
    let app_data = settings::app_data_dir(app)?;
    let lyrics_sidecar = settings::lyrics_sidecar_sync_enabled(app);
    let mut imported = 0u32;

    let conn = state
        .0
        .lock()
        .map_err(|e| format!("database lock poisoned: {e}"))?;

    for path in paths {
        let input = match metadata_reader::parse_track_metadata(&app_data, &path, lyrics_sidecar) {
            Ok(input) => input,
            Err(err) => {
                eprintln!("fresh import skip {path}: {err}");
                continue;
            }
        };
        match db::save_track(&conn, &input) {
            Ok(id) => {
                if let Err(e) = lyrics_normalize::persist_import_lyrics(&conn, id, &input.lyrics) {
                    eprintln!("fresh import lyrics for {path}: {e}");
                }
                imported = imported.saturating_add(1);
            }
            Err(e) => eprintln!("fresh import save {path}: {e}"),
        }
    }

    Ok(imported)
}

pub fn relocate_library(
    app: &AppHandle,
    state: &DbState,
    rating_sync: &RatingSync,
    new_root: &str,
    mode: LibraryRelocateMode,
) -> Result<LibrarySettingsResponse, String> {
    let dest = normalize_path(new_root);
    let current = settings::resolved_library_settings(app);
    let current_root = PathBuf::from(&current.library_root);
    let old_db = PathBuf::from(&current.database_path);
    let old_media = PathBuf::from(&current.media_folder);

    validate_destination(&current_root, &dest)?;

    let dest_db = settings::database_path_for_root(&dest);
    let dest_media = settings::media_folder_for_root(&dest);
    let old_artwork = settings::artwork_folder_for_root(&current_root);
    let dest_artwork = settings::artwork_folder_for_root(&dest);

    match mode {
        LibraryRelocateMode::Move => {
            if dest_db.is_file() {
                return Err(
                    "A Spiral library already exists here. Switch to it instead of moving.".into(),
                );
            }
            if dest_media.is_dir() {
                let non_empty = fs::read_dir(&dest_media)
                    .map(|mut d| d.next().is_some())
                    .unwrap_or(false);
                if non_empty {
                    return Err(
                        "Destination Tracks folder is not empty. Choose an empty folder or switch to an existing library."
                            .into(),
                    );
                }
                remove_path_best_effort(&dest_media);
            }

            rating_sync.clear_pending();
            release_db_to_memory(state)?;

            let move_result = (|| -> Result<(), String> {
                fs::create_dir_all(&dest)
                    .map_err(|e| format!("failed to create library folder: {e}"))?;
                if old_db.is_file() {
                    relocate_entry(&old_db, &dest_db)?;
                }
                if old_media.is_dir() {
                    relocate_entry(&old_media, &dest_media)?;
                }
                if old_artwork.is_dir() {
                    relocate_entry(&old_artwork, &dest_artwork)?;
                }
                Ok(())
            })();

            if let Err(err) = move_result {
                let _ = reopen_db(state, &old_db);
                return Err(err);
            }

            // Remove emptied old root if it's now empty (best effort).
            if current_root.is_dir() {
                if let Ok(mut entries) = fs::read_dir(&current_root) {
                    if entries.next().is_none() {
                        remove_path_best_effort(&current_root);
                    }
                }
            }

            match (|| -> Result<LibrarySettingsResponse, String> {
                let conn = db::open(&dest_db).map_err(|e| e.to_string())?;
                rewrite_media_paths(app, &conn, &old_media, &dest_media)?;
                drop(conn);

                let resolved = apply_library_root(app, &dest.to_string_lossy())?;
                library_paths::ensure_spiral_library(&resolved)?;
                reopen_db(state, Path::new(&resolved.database_path))?;
                Ok(resolved)
            })() {
                Ok(resolved) => Ok(resolved),
                Err(err) => {
                    // Files may already be at dest; prefer reopening there.
                    if dest_db.is_file() {
                        let _ = apply_library_root(app, &dest.to_string_lossy());
                        let _ = reopen_db(state, &dest_db);
                    } else if old_db.is_file() {
                        let _ = apply_library_root(app, &current.library_root);
                        let _ = reopen_db(state, &old_db);
                    }
                    Err(err)
                }
            }
        }
        LibraryRelocateMode::Switch => {
            if !dest_db.is_file() {
                return Err("No Spiral library database found in that folder".into());
            }
            rating_sync.clear_pending();
            release_db_to_memory(state)?;
            let resolved = apply_library_root(app, &dest.to_string_lossy())?;
            library_paths::ensure_spiral_library(&resolved)?;
            if let Err(err) = reopen_db(state, Path::new(&resolved.database_path)) {
                let _ = apply_library_root(app, &current.library_root);
                let _ = reopen_db(state, &old_db);
                return Err(err);
            }
            Ok(resolved)
        }
        LibraryRelocateMode::Fresh | LibraryRelocateMode::FreshImport => {
            if dest_db.is_file() {
                return Err("A Spiral library already exists here. Switch to it instead.".into());
            }
            rating_sync.clear_pending();
            release_db_to_memory(state)?;
            let resolved = apply_library_root(app, &dest.to_string_lossy())?;
            library_paths::ensure_spiral_library(&resolved)?;
            if let Err(err) = reopen_db(state, Path::new(&resolved.database_path)) {
                let _ = apply_library_root(app, &current.library_root);
                let _ = reopen_db(state, &old_db);
                return Err(err);
            }
            if mode == LibraryRelocateMode::FreshImport {
                let _ = import_audio_as_reference(app, state, &dest);
            }
            Ok(resolved)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_temp_dir(label: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("spiral-relocate-{label}-{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn validate_rejects_same_and_nested() {
        let root = PathBuf::from("/tmp/spiral-lib");
        let nested = root.join("Tracks");
        assert!(validate_destination(&root, &root).is_err());
        assert!(validate_destination(&root, &nested).is_err());
        assert!(validate_destination(&nested, &root).is_err());
        assert!(validate_destination(&root, Path::new("/tmp/other-lib")).is_ok());
    }

    #[test]
    fn rewrite_path_prefix_rewrites_under_media() {
        let old_media = Path::new("/Music/Spiral Library/Tracks");
        let new_media = Path::new("/Volumes/Big/Spiral Library/Tracks");
        let old = "/Music/Spiral Library/Tracks/Artist/Album/song.mp3";
        let next = rewrite_path_prefix(old, old_media, new_media).unwrap();
        assert_eq!(
            next,
            "/Volumes/Big/Spiral Library/Tracks/Artist/Album/song.mp3"
        );
        assert!(rewrite_path_prefix("/elsewhere/song.mp3", old_media, new_media).is_none());
    }

    #[test]
    fn rewrite_media_paths_updates_db_rows() {
        let dir = unique_temp_dir("db-rewrite");
        let old_media = dir.join("old").join("Tracks");
        let new_media = dir.join("new").join("Tracks");
        fs::create_dir_all(&old_media).unwrap();
        fs::create_dir_all(&new_media).unwrap();

        let db_path = dir.join("Library.db");
        let conn = db::open(&db_path).unwrap();
        let old_file = old_media.join("a.mp3");
        fs::write(&old_file, b"x").unwrap();

        db::save_track(
            &conn,
            &crate::models::TrackInput {
                title: "Song".into(),
                artist: None,
                album: None,
                album_artist: None,
                track_number: None,
                total_tracks: None,
                disc_number: None,
                total_discs: None,
                year: None,
                genre: None,
                duration_seconds: None,
                sample_rate: None,
                bitrate: None,
                codec: None,
                file_path: old_file.to_string_lossy().into_owned(),
                art_path: None,
                rating: None,
                lyrics: None,
                ..Default::default()
            },
        )
        .unwrap();

        // rewrite via rewrite_path_prefix + SQL (art cache needs AppHandle).
        let tracks = db::get_all_tracks(&conn).unwrap();
        assert_eq!(tracks.len(), 1);
        let new_path = rewrite_path_prefix(&tracks[0].file_path, &old_media, &new_media).unwrap();
        conn.execute(
            "UPDATE tracks SET file_path = ?1 WHERE id = ?2",
            rusqlite::params![new_path, tracks[0].id],
        )
        .unwrap();
        let updated = db::get_all_tracks(&conn).unwrap();
        assert_eq!(
            updated[0].file_path,
            new_media.join("a.mp3").to_string_lossy()
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn copy_dir_recursive_copies_files() {
        let dir = unique_temp_dir("copy");
        let from = dir.join("from");
        let to = dir.join("to");
        fs::create_dir_all(from.join("sub")).unwrap();
        fs::write(from.join("a.txt"), b"a").unwrap();
        fs::write(from.join("sub").join("b.txt"), b"b").unwrap();
        copy_dir_recursive(&from, &to).unwrap();
        assert_eq!(fs::read_to_string(to.join("a.txt")).unwrap(), "a");
        assert_eq!(
            fs::read_to_string(to.join("sub").join("b.txt")).unwrap(),
            "b"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn relocate_entry_rename_or_copy() {
        let dir = unique_temp_dir("rename");
        let from = dir.join("file.db");
        let to = dir.join("dest").join("file.db");
        fs::write(&from, b"db").unwrap();
        relocate_entry(&from, &to).unwrap();
        assert!(to.is_file());
        assert!(!from.exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn relocate_entry_refuses_existing_dest() {
        let dir = unique_temp_dir("exists");
        let from = dir.join("a.db");
        let to = dir.join("b.db");
        fs::write(&from, b"1").unwrap();
        fs::write(&to, b"2").unwrap();
        assert!(relocate_entry(&from, &to).is_err());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn relocate_mode_serde_roundtrip() {
        for mode in [
            LibraryRelocateMode::Move,
            LibraryRelocateMode::Switch,
            LibraryRelocateMode::Fresh,
            LibraryRelocateMode::FreshImport,
        ] {
            let json = serde_json::to_string(&mode).unwrap();
            let back: LibraryRelocateMode = serde_json::from_str(&json).unwrap();
            assert_eq!(mode, back);
        }
        assert_eq!(
            serde_json::from_str::<LibraryRelocateMode>(r#""freshImport""#).unwrap(),
            LibraryRelocateMode::FreshImport
        );
    }

    #[test]
    fn destination_info_serde_uses_camel_case() {
        let info = LibraryDestinationInfo {
            path: "/tmp/lib".into(),
            has_database: true,
            audio_file_count: 3,
            blocked_reason: Some("nope".into()),
        };
        let json = serde_json::to_value(&info).unwrap();
        assert!(json.get("hasDatabase").is_some());
        assert!(json.get("audioFileCount").is_some());
        assert!(json.get("blockedReason").is_some());
    }

    #[test]
    fn count_audio_finds_files() {
        let dir = unique_temp_dir("scan");
        fs::write(dir.join("song.mp3"), b"x").unwrap();
        assert_eq!(count_audio_unique(&dir), 1);
        let _ = fs::remove_dir_all(&dir);
    }
}
