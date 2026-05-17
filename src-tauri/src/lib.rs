mod art_cache;
mod cover_art_fetch;
mod commands;
mod db;
mod import_files;
mod library_paths;
#[cfg(target_os = "macos")]
mod macos_library_picker;
#[cfg(desktop)]
mod media_shortcuts;
mod metadata_writer;
mod models;
mod session;
mod settings;

use commands::library::DbState;
use std::sync::Mutex;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let db_path =
                library_paths::ensure_library_for_app(app.handle()).expect("failed to init library");
            let conn = db::open(&db_path).expect("failed to open database");
            app.manage(DbState(Mutex::new(conn)));

            #[cfg(desktop)]
            if let Err(err) = media_shortcuts::register(app.handle()) {
                eprintln!("failed to register media shortcuts: {err}");
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::files::pick_audio_files,
            commands::files::pick_library_paths,
            commands::files::scan_folder,
            commands::files::pick_folder,
            commands::files::read_file_bytes,
            commands::files::get_file_modified_ms,
            commands::library::save_track,
            commands::library::get_library,
            commands::library::remove_track,
            commands::metadata::pick_image_file,
            commands::metadata::cache_art_from_bytes,
            commands::metadata::cache_art_from_file,
            commands::metadata::cache_art_from_url,
            commands::metadata::fetch_cover_art,
            commands::metadata::write_track_metadata,
            commands::themes::get_builtin_themes,
            commands::themes::load_user_themes,
            commands::themes::save_active_theme_id,
            commands::themes::get_active_theme_id,
            commands::themes::open_themes_folder,
            commands::themes::import_user_theme,
            commands::library_settings::get_library_settings,
            commands::library_settings::save_library_settings,
            commands::library_settings::prepare_import_file,
            commands::library_settings::pick_database_folder,
            commands::playback_session::get_playback_session,
            commands::playback_session::save_playback_session,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
