mod art_cache;
mod audio_formats;
mod cd;
mod artist_art_fetch;
mod cover_art_fetch;
mod commands;
mod db;
mod import_files;
mod library_organize;
mod library_paths;
#[cfg(target_os = "macos")]
mod macos_library_picker;
#[cfg(desktop)]
mod media_session;
#[cfg(desktop)]
mod media_shortcuts;
mod metadata_backup;
mod metadata_reader;
mod metadata_writer;
mod models;
mod session;
mod settings;
mod track_list_prefs;

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

            #[cfg(desktop)]
            media_session::init(app.handle());

            cd::monitor::start_monitor(app.handle().clone());

            if let Err(err) = metadata_backup::run_scheduled_cleanup(app.handle()) {
                eprintln!("metadata backup cleanup on startup: {err}");
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app::quit_app,
            commands::files::pick_audio_files,
            commands::files::pick_library_paths,
            commands::files::scan_folder,
            commands::files::pick_folder,
            commands::files::get_file_modified_ms,
            commands::library::save_track,
            commands::library::get_library,
            commands::playlists::get_playlists,
            commands::playlists::create_playlist,
            commands::playlists::update_playlist,
            commands::playlists::touch_playlist,
            commands::playlists::add_tracks_to_playlist,
            commands::playlists::remove_tracks_from_playlist,
            commands::playlists::reorder_playlist_tracks,
            commands::playlists::delete_playlist,
            commands::library::record_track_play,
            commands::library::remove_track,
            commands::metadata::parse_track_metadata,
            commands::metadata::pick_image_file,
            commands::metadata::cache_art_from_bytes,
            commands::metadata::cache_art_from_file,
            commands::metadata::cache_art_from_url,
            commands::metadata::fetch_cover_art,
            commands::metadata::fetch_artist_art,
            commands::artist_images::get_artist_images,
            commands::artist_images::save_artist_image,
            commands::artist_images::rename_artist_image_key,
            commands::metadata::write_track_metadata,
            commands::themes::get_builtin_themes,
            commands::themes::load_user_themes,
            commands::themes::save_active_theme_id,
            commands::themes::get_active_theme_id,
            commands::themes::open_themes_folder,
            commands::themes::import_user_theme,
            commands::skins::list_skins,
            commands::skins::load_skin_pack,
            commands::skins::save_active_skin_id,
            commands::skins::get_active_skin_id,
            commands::skins::save_active_skin_view,
            commands::skins::get_active_skin_view,
            commands::skins::open_skins_folder,
            commands::skins::get_skin_schema,
            commands::library_settings::get_library_settings,
            commands::library_settings::save_library_settings,
            commands::library_settings::prepare_import_file,
            commands::library_settings::pick_database_folder,
            commands::playback_session::get_playback_session,
            commands::playback_session::save_playback_session,
            commands::track_list_preferences::get_track_list_preferences,
            commands::track_list_preferences::save_track_list_preferences,
            commands::cd::list_cd_drives,
            commands::cd::probe_cd_drive,
            commands::cd::get_disc_info,
            commands::cd::get_disc_cdtext,
            commands::cd::eject_cd_disc,
            commands::cd::set_cd_detail_drive,
            commands::cd::start_cd_playback,
            commands::cd::pause_cd_playback,
            commands::cd::resume_cd_playback,
            commands::cd::seek_cd_playback,
            commands::cd::stop_cd_playback,
            commands::cd::ack_cd_playback_pcm,
            #[cfg(desktop)]
            media_session::update_media_session,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
