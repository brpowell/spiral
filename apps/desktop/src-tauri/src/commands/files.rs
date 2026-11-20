use super::library::DbState;
use crate::audio_formats::filter_library_import_paths;
use crate::db;
use crate::file_scan::scan_folder_paths;
use crate::path_scope;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use tauri::{AppHandle, Manager};

/// In scope, or a library track's file.
fn is_known_path(app: &AppHandle, path: &Path) -> bool {
    if path_scope::is_allowed(app, path) {
        return true;
    }
    let Some(state) = app.try_state::<DbState>() else {
        return false;
    };
    let Ok(conn) = state.0.lock() else {
        return false;
    };
    db::has_track_file_path(&conn, &path.to_string_lossy()).unwrap_or(false)
}

/// Whether the webview may have `path` opened for decoding (playback, tag
/// reads). Today that means a known root (the library, a source, an app-owned
/// folder such as the one sound packs live in), a library track's file, or a
/// file the user picked or dropped this session; see [`is_known_path`].
///
/// Seam for playing a one-off file without adding it to a source: the
/// backend-owned allow-list is the picked-files set in [`path_scope`], filled
/// only by [`path_scope::allow_user_paths`] from what the OS itself reported
/// (a native file dialog, a native drop). To accept another such source, such
/// as files the OS opened the app with, call `allow_user_paths` for them from
/// that Rust handler; this check then admits them unchanged. Never add a path
/// the webview sends.
pub(crate) fn playable_path_allowed(app: &AppHandle, path: &Path) -> bool {
    path_scope::is_plain_absolute(path) && is_known_path(app, path)
}

/// The path to open for playback, or `Err` when [`playable_path_allowed`]
/// says no. `path` may be a network-location URI the OS already reported (see
/// [`path_scope::resolved_network_uri`]).
pub(crate) fn ensure_playable_path(app: &AppHandle, path: &str) -> Result<PathBuf, String> {
    let path = path_scope::resolved_network_uri(app, path).unwrap_or_else(|| PathBuf::from(path));
    check_playable(path, |path| playable_path_allowed(app, path))
}

/// Shape of [`ensure_playable_path`]: a relative or `..` path is refused with
/// no disk access. Otherwise the file is probed first, with a bound, because
/// the scope check resolves the path and that blocks on a dead share with
/// nothing to bound it. A missing file outside scope gets the same error as
/// one that exists, so the reply doesn't tell the webview what is on disk.
fn check_playable(path: PathBuf, allowed: impl FnOnce(&Path) -> bool) -> Result<PathBuf, String> {
    if !path_scope::is_plain_absolute(&path) {
        return Err(path_scope::outside_scope_error(&path));
    }
    let probed = crate::fs_probe::probe_file_before_use(&path);
    if probed == crate::fs_probe::Probed::Stalled {
        return Err(crate::file_playback::not_responding(
            &path.to_string_lossy(),
        ));
    }
    if !allowed(&path) {
        return Err(path_scope::outside_scope_error(&path));
    }
    if probed == crate::fs_probe::Probed::No {
        return Err(format!("File not found: {}", path.display()));
    }
    Ok(path)
}

/// The resolved path to use for the actual file operation, when `path` is in
/// scope or is a library track's file. `path` may be a network-location URI;
/// it only resolves to a local path here if it matches one the OS already
/// reported via a drop or a pick (see [`path_scope::resolved_network_uri`]),
/// never by resolving a fresh one from a string a command merely receives.
fn ensure_known_path(app: &AppHandle, path: &str) -> Result<PathBuf, String> {
    let resolved =
        path_scope::resolved_network_uri(app, path).unwrap_or_else(|| PathBuf::from(path));
    if is_known_path(app, &resolved) {
        Ok(resolved)
    } else {
        Err(path_scope::outside_scope_error(&resolved))
    }
}

#[tauri::command]
pub fn pick_audio_files(app: AppHandle) -> Result<Vec<String>, String> {
    let paths = rfd::FileDialog::new()
        .set_title("Select audio files")
        .add_filter(
            "Audio",
            &[
                "mp3", "flac", "aac", "wav", "m4a", "mp4", "ogg", "opus", "zip", "MP3", "FLAC",
                "AAC", "WAV", "M4A", "MP4", "OGG", "OPUS", "ZIP",
            ],
        )
        .set_directory("/")
        .pick_files();
    if let Some(files) = &paths {
        path_scope::allow_user_paths(&app, files);
    }

    match paths {
        Some(files) => Ok(filter_library_import_paths(
            files
                .into_iter()
                .map(|p| p.to_string_lossy().into_owned())
                .collect(),
        )),
        None => Ok(vec![]),
    }
}

/// Walking the folder can be slow over a network source; keep it off the main thread.
#[tauri::command]
pub async fn scan_folder(app: AppHandle, folder_path: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let folder_path = path_scope::ensure_allowed(&app, &folder_path)?;
        scan_folder_paths(&folder_path.to_string_lossy())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// A file on a network share that dropped reads as missing after
/// [`crate::fs_probe::PROBE_TIMEOUT`], instead of holding a worker thread for
/// as long as the share stalls. For a track in a source, playback asks about
/// its folder first with a longer wait, so a slow share is awake by then.
#[tauri::command]
pub async fn file_exists(app: AppHandle, path: String) -> bool {
    tauri::async_runtime::spawn_blocking(move || {
        let path =
            path_scope::resolved_network_uri(&app, &path).unwrap_or_else(|| PathBuf::from(&path));
        known_file_exists(&path, |path| is_known_path(&app, path))
    })
    .await
    .unwrap_or(false)
}

/// Whether `path` is a file that `is_known` allows. The file is checked first,
/// with a bounded probe: the scope check resolves the path, which on a dead
/// share blocks with nothing to bound it.
fn known_file_exists(path: &Path, is_known: impl FnOnce(&Path) -> bool) -> bool {
    crate::fs_probe::probe_file(path).is_yes() && is_known(path)
}

/// File size in bytes. Stat-ing and resolving the path can be slow over a
/// network source; keep it off the main thread.
#[tauri::command]
pub async fn get_file_size(app: AppHandle, path: String) -> Result<u64, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = ensure_known_path(&app, &path)?;
        let meta = std::fs::metadata(&path).map_err(|e| format!("Cannot stat file: {e}"))?;
        Ok(meta.len())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Total size of all files under a directory (does not follow symlinks). Can
/// be slow over a network source; keep it off the main thread.
#[tauri::command]
pub async fn get_directory_size(app: AppHandle, path: String) -> Result<u64, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = path_scope::ensure_allowed(&app, &path)?;
        directory_size_bytes(&path)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn directory_size_bytes(root: &Path) -> Result<u64, String> {
    if !root.is_dir() {
        return Err(format!("Not a directory: {}", root.display()));
    }

    let mut total: u64 = 0;
    for entry in walkdir::WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        if path.is_file() {
            let meta = std::fs::metadata(path)
                .map_err(|e| format!("Cannot stat {}: {e}", path.display()))?;
            total = total.saturating_add(meta.len());
        }
    }
    Ok(total)
}

/// File modification time in milliseconds since UNIX epoch (for asset URL
/// cache busting). Can be slow over a network source; keep it off the main thread.
#[tauri::command]
pub async fn get_file_modified_ms(app: AppHandle, path: String) -> Result<u64, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = path_scope::ensure_allowed(&app, &path)?;
        let meta = std::fs::metadata(&path).map_err(|e| format!("Cannot stat file: {e}"))?;
        let modified = meta
            .modified()
            .map_err(|e| format!("Cannot read modification time: {e}"))?;
        modified
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .map_err(|e| format!("Invalid modification time: {e}"))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn pick_folder(app: AppHandle) -> Result<Vec<String>, String> {
    let folder = rfd::FileDialog::new()
        .set_title("Select music folder")
        .pick_folder();

    match folder {
        Some(path) => {
            path_scope::allow_dir(&app, &path);
            Ok(vec![path.to_string_lossy().into_owned()])
        }
        None => Ok(vec![]),
    }
}

/// Open a picker for audio files and/or folders (platform-dependent capabilities).
#[cfg(target_os = "macos")]
#[tauri::command]
pub fn pick_library_paths(app: AppHandle) -> Result<Vec<String>, String> {
    let paths = crate::macos_library_picker::pick_library_paths(&app).unwrap_or_default();
    path_scope::allow_user_paths(&app, &paths);
    Ok(filter_library_import_paths(paths))
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn pick_library_paths(app: AppHandle) -> Result<Vec<String>, String> {
    pick_audio_files(app)
}

#[cfg(test)]
mod tests {
    #[test]
    fn a_file_on_a_stalled_share_is_missing_without_resolving_its_path() {
        let path = std::env::temp_dir().join(format!(
            "spiral-file-exists-stalled-{}/track.flac",
            std::process::id()
        ));
        let _stall = crate::fs_probe::stall_file(&path);
        let started = std::time::Instant::now();
        assert!(!known_file_exists(&path, |_| unreachable!(
            "the scope check would block on the dead share"
        )));
        assert!(started.elapsed() < std::time::Duration::from_millis(500));
    }

    #[test]
    fn a_file_is_there_only_when_it_exists_and_is_known() {
        let dir = std::env::temp_dir().join(format!("spiral-file-exists-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("a.mp3");
        std::fs::write(&file, b"x").unwrap();
        assert!(known_file_exists(&file, |_| true));
        assert!(!known_file_exists(&file, |_| false));
        assert!(!known_file_exists(&dir.join("gone.mp3"), |_| true));
        let _ = std::fs::remove_dir_all(&dir);
    }

    fn playable_root(name: &str) -> std::path::PathBuf {
        let root =
            std::env::temp_dir().join(format!("spiral-playable-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("library")).unwrap();
        fs::write(root.join("library/a.mp3"), b"x").unwrap();
        fs::write(root.join("x.mp3"), b"x").unwrap();
        root
    }

    #[test]
    fn plays_a_file_inside_a_known_root() {
        let root = playable_root("in");
        let scope = crate::path_scope::test_dir_scope(&root.join("library"));
        let file = root.join("library/a.mp3");
        assert_eq!(check_playable(file.clone(), &scope), Ok(file));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn refuses_a_file_outside_every_known_root() {
        let root = playable_root("out");
        let scope = crate::path_scope::test_dir_scope(&root.join("library"));
        let err = check_playable(root.join("x.mp3"), &scope).unwrap_err();
        assert!(err.starts_with("path is outside the library"), "{err}");
        // A missing file outside scope says the same, so the reply doesn't
        // reveal what exists on disk.
        let err = check_playable(root.join("gone.mp3"), &scope).unwrap_err();
        assert!(err.starts_with("path is outside the library"), "{err}");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_missing_file_inside_a_known_root_is_not_found() {
        let root = playable_root("missing");
        let scope = crate::path_scope::test_dir_scope(&root.join("library"));
        let err = check_playable(root.join("library/gone.mp3"), &scope).unwrap_err();
        assert!(err.starts_with("File not found"), "{err}");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn refuses_dot_dot_and_relative_paths_without_asking_the_scope() {
        let root = playable_root("dotdot");
        let never = |_: &Path| -> bool { unreachable!("refused before the scope check") };
        for path in [
            root.join("library/../x.mp3"),
            std::path::PathBuf::from("library/a.mp3"),
            std::path::PathBuf::from("../x.mp3"),
        ] {
            let err = check_playable(path.clone(), never).unwrap_err();
            assert!(
                err.starts_with("path is outside the library"),
                "{}: {err}",
                path.display()
            );
        }
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_file_on_a_stalled_share_is_not_responding_without_resolving_its_path() {
        let path = std::env::temp_dir().join(format!(
            "spiral-playable-stalled-{}/track.flac",
            std::process::id()
        ));
        let _stall = crate::fs_probe::stall_file(&path);
        let started = std::time::Instant::now();
        let err = check_playable(path, |_| {
            unreachable!("the scope check would block on the dead share")
        })
        .unwrap_err();
        assert!(err.starts_with(crate::sources::SOURCE_UNAVAILABLE), "{err}");
        assert!(started.elapsed() < std::time::Duration::from_millis(500));
    }

    use super::{check_playable, directory_size_bytes, known_file_exists};
    use std::fs;
    use std::path::Path;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn directory_size_sums_nested_files() {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("spiral-dir-size-{nanos}"));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("nested")).unwrap();
        fs::write(root.join("a.txt"), b"aaaa").unwrap();
        fs::write(root.join("nested/b.txt"), b"bbbbbb").unwrap();

        let size = directory_size_bytes(&root).unwrap();
        assert_eq!(size, 10);

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn directory_size_rejects_file_path() {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let file = std::env::temp_dir().join(format!("spiral-dir-size-file-{nanos}"));
        fs::write(&file, b"x").unwrap();
        assert!(directory_size_bytes(&file).is_err());
        let _ = fs::remove_file(&file);
    }
}
