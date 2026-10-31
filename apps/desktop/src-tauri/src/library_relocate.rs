use crate::commands::library::DbState;
use crate::db;
use crate::file_scan::scan_folder_paths;
use crate::library_organize;
use crate::library_paths;
use crate::lyrics_normalize;
use crate::metadata_reader;
use crate::rating_sync::RatingSync;
use crate::settings::{self, LibrarySettingsPatch, LibrarySettingsResponse, DATABASE_FILE_NAME};
use crate::sources::{self, SourceRoots};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

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

/// Roots of the user's sources in the open library.
fn watched_roots(app: &AppHandle) -> Vec<PathBuf> {
    let state = app.state::<DbState>();
    let conn = state.0.lock().unwrap_or_else(|e| e.into_inner());
    sources::user_source_roots(&conn)
        .unwrap_or_default()
        .into_iter()
        .map(|(_, root)| root)
        .collect()
}

/// `watched` are the watched folders' roots. A library may sit inside a
/// watched folder, but not in the same place as one or around one.
fn validate_destination(
    current_root: &Path,
    dest: &Path,
    watched: &[PathBuf],
) -> Result<(), String> {
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
    if let Some(root) = watched
        .iter()
        .find(|w| paths_equal(dest, w) || is_nested(w, dest))
    {
        return Err(format!(
            "Choose a folder that isn't the watched folder {} and doesn't contain it",
            root.display()
        ));
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

    let blocked_reason = validate_destination(&current_root, &dest, &watched_roots(app)).err();

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

/// After the Spiral folder moved, carry over artwork cached in app data, which
/// is keyed by file path. Track rows need no rewrite: the default source's
/// paths are relative to its `Tracks` folder, which follows the database.
pub(crate) fn migrate_moved_art_cache(
    app_data: &Path,
    conn: &Connection,
    old_media: &Path,
) -> Result<(), String> {
    let roots = SourceRoots::load(conn).map_err(|e| e.to_string())?;
    let tracks: Vec<(i64, String, String)> = conn
        .prepare(
            "SELECT id, rel_path, art_path FROM tracks
             WHERE source_id = ?1 AND art_path IS NOT NULL",
        )
        .and_then(|mut stmt| {
            stmt.query_map(rusqlite::params![sources::DEFAULT_SOURCE_ID], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            })?
            .collect()
        })
        .map_err(|e| e.to_string())?;

    for (id, rel_path, art_path) in tracks {
        // Library-relative Artwork/ paths stay valid across the move, and
        // absolute track paths didn't move.
        if art_path.starts_with("Artwork/")
            || art_path.starts_with("Artwork\\")
            || Path::new(&rel_path).is_absolute()
        {
            continue;
        }
        let old_path = sources::join_rel_path(old_media, &rel_path);
        let new_path = roots.resolve(sources::DEFAULT_SOURCE_ID, &rel_path);
        let new_art = library_organize::migrate_art_cache(
            app_data,
            &old_path.to_string_lossy(),
            &new_path,
            Some(&art_path),
        )?;
        if new_art.as_deref() != Some(art_path.as_str()) {
            conn.execute(
                "UPDATE tracks SET art_path = ?1 WHERE id = ?2",
                rusqlite::params![new_art, id],
            )
            .map_err(|e| format!("failed to update track art: {e}"))?;
        }
    }
    Ok(())
}

/// Rewrite linked item paths that live under `olds` (the old Packs folder, as stored and as
/// canonicalized) so they point at the same relative place under `new`.
pub(crate) fn rewrite_linked_paths(stored: &[String], olds: &[PathBuf], new: &Path) -> Vec<String> {
    stored
        .iter()
        .map(|raw| {
            let path = PathBuf::from(raw.trim());
            olds.iter()
                .find_map(|old| path.strip_prefix(old).ok())
                .map(|rest| new.join(rest).to_string_lossy().into_owned())
                .unwrap_or_else(|| raw.clone())
        })
        .collect()
}

fn apply_library_root(app: &AppHandle, new_root: &str) -> Result<LibrarySettingsResponse, String> {
    let resolved = settings::merge_library_settings(
        app,
        LibrarySettingsPatch {
            library_root: Some(new_root.to_string()),
            ..Default::default()
        },
    )?;
    // The Packs folder lives inside the library, so the file watcher follows it.
    crate::packs::retarget_library_packs_watch(app);
    Ok(resolved)
}

fn import_audio_as_reference(app: &AppHandle, state: &DbState, root: &Path) -> Result<u32, String> {
    let paths = scan_folder_paths(&root.to_string_lossy())?;
    let app_data = settings::app_data_dir(app)?;
    let lyrics_sidecar = settings::lyrics_sidecar_sync_enabled(app);
    let mut imported = 0u32;
    let roots = crate::sources::LibraryRoots::for_library_root(root);

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
        let source_id = crate::sources::source_for_path(&conn, &roots, Path::new(&path))
            .map_err(|e| e.to_string())?;
        match db::save_track(&conn, &input, source_id) {
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

    validate_destination(&current_root, &dest, &watched_roots(app))?;

    let dest_db = settings::database_path_for_root(&dest);
    let dest_media = settings::media_folder_for_root(&dest);
    let old_artwork = settings::artwork_folder_for_root(&current_root);
    let dest_artwork = settings::artwork_folder_for_root(&dest);
    let old_packs = current_root.join(crate::packs::LIBRARY_PACKS_DIR_NAME);
    let old_packs_prefixes: Vec<PathBuf> = [Some(old_packs.clone()), old_packs.canonicalize().ok()]
        .into_iter()
        .flatten()
        .collect();
    let dest_packs = dest.join(crate::packs::LIBRARY_PACKS_DIR_NAME);

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
                if old_packs.is_dir() {
                    relocate_entry(&old_packs, &dest_packs)?;
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
                migrate_moved_art_cache(&settings::app_data_dir(app)?, &conn, &old_media)?;
                drop(conn);

                // Items created in the Library are linked by absolute path; follow the move.
                if dest_packs.is_dir() {
                    let new_packs = dest_packs.canonicalize().unwrap_or(dest_packs.clone());
                    let mut app_settings = settings::read_settings(app);
                    app_settings.linked_item_paths = rewrite_linked_paths(
                        &app_settings.linked_item_paths,
                        &old_packs_prefixes,
                        &new_packs,
                    );
                    settings::write_settings(app, &app_settings)?;
                }

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
    fn rewrite_linked_paths_follows_the_packs_folder_only() {
        let stored = vec![
            "/Music/Spiral Library/Packs/themes/bryan.one".to_string(),
            "/Users/bryan/dev/my-skin".to_string(),
        ];
        let out = rewrite_linked_paths(
            &stored,
            &[PathBuf::from("/Music/Spiral Library/Packs")],
            Path::new("/Volumes/Big/Spiral Library/Packs"),
        );
        assert_eq!(
            out,
            vec![
                "/Volumes/Big/Spiral Library/Packs/themes/bryan.one".to_string(),
                "/Users/bryan/dev/my-skin".to_string(),
            ]
        );
    }

    #[test]
    fn validate_rejects_same_and_nested() {
        let root = PathBuf::from("/tmp/spiral-lib");
        let nested = root.join("Tracks");
        assert!(validate_destination(&root, &root, &[]).is_err());
        assert!(validate_destination(&root, &nested, &[]).is_err());
        assert!(validate_destination(&nested, &root, &[]).is_err());
        assert!(validate_destination(&root, Path::new("/tmp/other-lib"), &[]).is_ok());
    }

    #[test]
    fn validate_rejects_a_library_on_or_around_a_watched_folder() {
        let root = PathBuf::from("/tmp/spiral-lib");
        let watched = [PathBuf::from("/Volumes/Big/Music/Collection")];
        let refused = |dest: &str| validate_destination(&root, Path::new(dest), &watched);
        assert!(refused("/Volumes/Big/Music/Collection").is_err());
        assert!(refused("/Volumes/Big/Music").is_err());
        assert!(refused("/Volumes/Big").is_err());
        // Inside a watched folder is allowed; scans skip the library.
        assert!(refused("/Volumes/Big/Music/Collection/Spiral Library").is_ok());
        assert!(refused("/Volumes/Big/Music/Collection2").is_ok());
        assert!(refused("/Volumes/Other/Spiral Library").is_ok());
    }

    #[test]
    fn moving_the_spiral_folder_needs_no_track_rewrite() {
        let dir = unique_temp_dir("db-move");
        let old_root = dir.join("old");
        let new_root = dir.join("new");
        fs::create_dir_all(old_root.join("Tracks/A")).unwrap();
        let old_file = old_root.join("Tracks/A/a.mp3");
        fs::write(&old_file, b"x").unwrap();
        {
            let conn = db::open(&old_root.join("Library.db")).unwrap();
            db::save_track(
                &conn,
                &crate::models::TrackInput {
                    title: "Song".into(),
                    file_path: old_file.to_string_lossy().into_owned(),
                    ..Default::default()
                },
                sources::DEFAULT_SOURCE_ID,
            )
            .unwrap();
        }
        fs::rename(&old_root, &new_root).unwrap();

        let conn = db::open(&new_root.join("Library.db")).unwrap();
        let app_data = dir.join("AppData");
        migrate_moved_art_cache(&app_data, &conn, &old_root.join("Tracks")).unwrap();
        let tracks = db::get_all_tracks(&conn).unwrap();
        assert_eq!(
            tracks[0].file_path,
            new_root.join("Tracks/A/a.mp3").to_string_lossy()
        );
        assert!(Path::new(&tracks[0].file_path).is_file());
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
