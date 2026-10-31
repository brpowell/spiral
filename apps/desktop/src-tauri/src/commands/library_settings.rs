use crate::commands::library::DbState;
use crate::import_files;
use crate::library_paths;
use crate::library_relocate::{self, LibraryRelocateMode};
use crate::path_scope;
use crate::rating_sync::RatingSync;
use crate::settings::{self, LibrarySettingsPatch, LibrarySettingsResponse};
use crate::sources;
use tauri::{AppHandle, State};

#[tauri::command]
pub fn get_library_settings(app: AppHandle) -> Result<LibrarySettingsResponse, String> {
    Ok(settings::resolved_library_settings(&app))
}

#[tauri::command]
pub fn save_library_settings(
    app: AppHandle,
    library: LibrarySettingsPatch,
) -> Result<LibrarySettingsResponse, String> {
    let resolved = settings::merge_library_settings(&app, library)?;
    library_paths::ensure_spiral_library(&resolved)?;
    path_scope::allow_library_dirs(&app);
    Ok(resolved)
}

/// Copy a file into the import source, organized the way that source is, or
/// (mode `reference`) leave it where it is. Returns the path to save.
#[tauri::command]
pub fn prepare_import_file(
    app: AppHandle,
    state: State<'_, DbState>,
    source_path: String,
    mode: String,
) -> Result<String, String> {
    path_scope::ensure_allowed(&app, &source_path)?;
    let resolved = settings::resolved_library_settings(&app);
    prepare_import(
        &state,
        &source_path,
        &mode,
        &resolved.organize_path_format,
        resolved.lyrics_sidecar_sync_enabled,
    )
}

fn prepare_import(
    state: &DbState,
    source_path: &str,
    mode: &str,
    global_format: &str,
    lyrics_sidecar_enabled: bool,
) -> Result<String, String> {
    if mode == "reference" {
        return import_files::reference_import_file(source_path);
    }
    let target = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        let id = sources::import_source_id(&conn).map_err(|e| e.to_string())?;
        sources::write_target(&conn, id, global_format)?
    };
    import_files::prepare_import_file(
        source_path,
        mode,
        import_files::ImportDestination {
            folder: &target.root,
            path_format: target.path_format.as_deref(),
        },
        lyrics_sidecar_enabled,
        None,
    )
}

/// `start` itself, or its closest ancestor that exists, so the picker never
/// opens on a folder that has not been created yet (e.g. a fresh default library).
fn nearest_existing_dir(start: &str) -> Option<std::path::PathBuf> {
    let mut candidate = std::path::Path::new(start);
    if candidate.as_os_str().is_empty() {
        return None;
    }
    loop {
        if candidate.is_dir() {
            return Some(candidate.to_path_buf());
        }
        candidate = candidate.parent()?;
    }
}

#[tauri::command]
pub fn pick_library_folder(start_dir: Option<String>) -> Result<Option<String>, String> {
    let mut dialog = rfd::FileDialog::new().set_title("Choose Spiral library folder");
    if let Some(dir) = start_dir.as_deref().and_then(nearest_existing_dir) {
        dialog = dialog.set_directory(dir);
    }
    let folder = dialog.pick_folder();

    Ok(folder.map(|p| p.to_string_lossy().into_owned()))
}

#[tauri::command]
pub fn inspect_library_destination(
    app: AppHandle,
    path: String,
) -> Result<library_relocate::LibraryDestinationInfo, String> {
    library_relocate::inspect_library_destination(&app, &path)
}

#[tauri::command]
pub fn relocate_library(
    app: AppHandle,
    state: State<'_, DbState>,
    rating_sync: State<'_, RatingSync>,
    new_root: String,
    mode: LibraryRelocateMode,
) -> Result<LibrarySettingsResponse, String> {
    let resolved = library_relocate::relocate_library(&app, &state, &rating_sync, &new_root, mode)?;
    path_scope::allow_library_dirs(&app);
    // The open library may have other watched folders now.
    super::organize::init(&app);
    Ok(resolved)
}

#[cfg(test)]
mod tests {
    use super::nearest_existing_dir;

    mod import_target {
        use super::super::prepare_import;
        use crate::commands::library::DbState;
        use crate::source_test_support::*;
        use crate::sources;
        use crate::test_fixtures::ogg;
        use std::path::Path;
        use std::sync::Mutex;

        const GLOBAL: &str = "{artist}/{title}.{ext}";

        #[test]
        fn imports_are_copied_into_the_import_source_its_own_way() {
            let tmp = TempDir::new("import-target");
            let conn = conn();
            let organized = tmp.dir("Organized");
            let loose = tmp.dir("Loose");
            let organized_id = add_user_source(&conn, &organized);
            let loose_id = add_user_source(&conn, &loose);
            sources::set_source_organize(&conn, organized_id, true).unwrap();
            sources::set_source_path_format(&conn, organized_id, Some("{title}/x.{ext}".into()))
                .unwrap();
            let state = DbState(Mutex::new(conn));
            let incoming = ogg::copy_minimal(&tmp.dir("Incoming"), "song.ogg");
            let incoming = incoming.to_string_lossy();
            let set_target = |id| {
                sources::set_import_source(&state.0.lock().unwrap(), id).unwrap();
            };

            set_target(organized_id);
            let copied = prepare_import(&state, &incoming, "copy", GLOBAL, false).unwrap();
            let copied = Path::new(&copied);
            assert!(copied.starts_with(&organized), "{}", copied.display());
            assert!(copied.ends_with("x.ogg"), "{}", copied.display());
            assert!(copied.is_file());

            set_target(loose_id);
            let copied = prepare_import(&state, &incoming, "copy", GLOBAL, false).unwrap();
            assert_eq!(Path::new(&copied), loose.join("song.ogg"));
        }

        #[test]
        fn keeping_files_in_place_never_copies() {
            let tmp = TempDir::new("import-reference");
            let state = DbState(Mutex::new(conn()));
            let file = ogg::copy_minimal(&tmp.0, "song.ogg");
            let path = file.to_string_lossy();
            assert_eq!(
                prepare_import(&state, &path, "reference", GLOBAL, false).unwrap(),
                path
            );
            assert_eq!(std::fs::read_dir(&tmp.0).unwrap().count(), 1);
            let missing = tmp.0.join("gone.ogg");
            assert!(prepare_import(
                &state,
                &missing.to_string_lossy(),
                "reference",
                GLOBAL,
                false
            )
            .is_err());
        }
    }

    #[test]
    fn nearest_existing_dir_returns_existing_dir_as_is() {
        let dir = std::env::temp_dir();
        assert_eq!(nearest_existing_dir(dir.to_str().unwrap()), Some(dir));
    }

    #[test]
    fn nearest_existing_dir_walks_up_from_missing_folder() {
        let dir = std::env::temp_dir();
        let missing = dir.join("spiral-missing-library").join("nested");
        assert_eq!(nearest_existing_dir(missing.to_str().unwrap()), Some(dir));
    }

    #[test]
    fn nearest_existing_dir_ignores_empty_input() {
        assert_eq!(nearest_existing_dir(""), None);
    }
}
