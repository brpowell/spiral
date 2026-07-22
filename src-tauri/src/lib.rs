mod art_cache;
mod art_thumb;
mod audio_formats;
mod audio_properties;
mod cd;
mod encoding_profiles;
mod transcoder;
mod artist_art_fetch;
mod artist_tags;
mod cover_art_fetch;
mod disc_metadata_cache;
mod musicbrainz_disc;
mod activity_log;
mod crash_report;
mod commands;
mod db;
mod diagnostics_export;
mod file_playback;
mod file_scan;
mod import_files;
mod library_organize;
mod library_paths;
mod library_relocate;
mod lyrics_fetch;
mod lyrics_fetch_cache;
mod lyrics_lrc;
mod lyrics_normalize;
mod lyrics_sidecar;
mod lyrics_tags;
#[cfg(target_os = "macos")]
mod macos_library_picker;
#[cfg(desktop)]
mod media_session;
#[cfg(desktop)]
mod media_shortcuts;
mod metadata_backup;
pub mod metadata_reader;
pub mod tag_inspector;
mod metadata_writer;
mod rating_sync;
mod rating_tags;
mod models;
mod session;
mod settings;
mod track_list_prefs;
mod vorbis_container;
mod packs;
mod zip_import;
mod skin_preferences;
#[cfg(test)]
mod ogg_opus_tests;
#[cfg(test)]
mod test_fixtures;

use commands::library::DbState;
use rating_sync::RatingSync;
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
            app.manage(RatingSync::new());

            #[cfg(desktop)]
            if let Err(err) = media_shortcuts::register(app.handle()) {
                eprintln!("failed to register media shortcuts: {err}");
            }

            #[cfg(desktop)]
            media_session::init(app.handle());

            cd::monitor::start_monitor(app.handle().clone());

            activity_log::init(app.handle().clone());
            crash_report::init(app.handle().clone());

            if let Err(err) = packs::ensure_packs_ready(app.handle()) {
                eprintln!("pack dirs on startup: {err}");
            }

            packs::start_workshop_watch(app.handle().clone());

            if let Err(err) = metadata_backup::run_scheduled_cleanup(app.handle()) {
                eprintln!("metadata backup cleanup on startup: {err}");
            }

            // Match frontend `usesCustomWindowChrome()` — Windows now; add Linux when enabling there.
            #[cfg(target_os = "windows")]
            {
                for label in ["main", "appearance", "equalizer", "activity-logs"] {
                    if let Some(window) = app.get_webview_window(label) {
                        if let Err(err) = window.set_decorations(false) {
                            eprintln!(
                                "failed to disable decorations on `{label}`: {err}"
                            );
                        }
                        if let Err(err) = window.set_shadow(true) {
                            eprintln!("failed to enable shadow on `{label}`: {err}");
                        }
                    }
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app::quit_app,
            commands::files::pick_audio_files,
            commands::files::pick_library_paths,
            commands::files::scan_folder,
            zip_import::scan_zip_import,
            zip_import::cleanup_zip_import,
            commands::files::pick_folder,
            commands::files::get_file_size,
            commands::files::get_file_modified_ms,
            commands::files::file_exists,
            commands::library::save_track,
            commands::library::get_library,
            commands::library::refresh_library_metadata,
            commands::library::replace_track_from_import,
            commands::library::convert_track,
            commands::library::get_convert_profile_options,
            commands::playlists::get_playlists,
            commands::playlists::create_playlist,
            commands::playlists::update_playlist,
            commands::playlists::touch_playlist,
            commands::playlists::add_tracks_to_playlist,
            commands::playlists::remove_tracks_from_playlist,
            commands::playlists::reorder_playlist_tracks,
            commands::playlists::reorder_playlists,
            commands::playlists::delete_playlist,
            commands::library::record_listen_event,
            commands::library::clear_listen_history,
            commands::library::set_track_rating,
            commands::library::remove_track,
            commands::lyrics::get_track_lyrics,
            commands::lyrics::mark_track_instrumental,
            commands::lyrics::fetch_lyrics_lrclib,
            commands::lyrics::cancel_lyrics_fetch,
            commands::lyrics::clear_lyrics_fetch_cancel,
            commands::lyrics::peek_lyrics_fetch_cache,
            commands::metadata::parse_track_metadata,
            commands::metadata::pick_image_file,
            commands::metadata::cache_art_from_bytes,
            commands::metadata::cache_art_from_file,
            commands::metadata::cache_art_from_url,
            commands::metadata::resolve_cached_art_path,
            commands::metadata::ensure_art_row_thumb,
            commands::metadata::fetch_cover_art,
            commands::metadata::fetch_cover_art_for_release,
            commands::metadata::fetch_artist_art,
            commands::metadata::clear_metadata_cache,
            commands::artist_images::get_artist_images,
            commands::artist_images::save_artist_image,
            commands::artist_images::rename_artist_image_key,
            commands::metadata::write_track_metadata,
            commands::themes::get_builtin_themes,
            commands::themes::load_user_themes,
            commands::themes::save_active_theme_id,
            commands::themes::get_active_theme_id,
            commands::themes::create_workshop_theme,
            commands::themes::save_workshop_theme,
            commands::themes::delete_workshop_theme,
            commands::packs::install_pack,
            commands::packs::get_workshop_export_defaults,
            commands::packs::export_workshop_pack,
            commands::packs::list_packs,
            commands::packs::create_workshop_pack,
            commands::packs::link_pack_folder,
            commands::packs::unlink_pack,
            commands::packs::get_pack_scan_warnings,
            commands::packs::update_workshop_pack_metadata,
            commands::packs::update_linked_pack_metadata,
            commands::packs::read_pack_readme,
            commands::packs::write_pack_readme,
            commands::packs::delete_workshop_pack,
            commands::packs::delete_workshop_contribution,
            commands::packs::uninstall_pack,
            commands::packs::rollback_pack,
            commands::packs::set_contribution_hidden,
            commands::packs::get_default_author_id,
            commands::packs::save_default_author_id,
            commands::skins::list_skins,
            commands::skins::load_skin_pack,
            commands::skins::save_active_skin_id,
            commands::skins::get_active_skin_id,
            commands::skins::save_active_skin_view,
            commands::skins::get_active_skin_view,
            commands::visualizers::list_visualizers,
            commands::visualizers::load_visualizer,
            commands::visualizers::read_viz_renderer_source,
            commands::visualizers::save_active_visualizer_id,
            commands::visualizers::get_active_visualizer_id,
            commands::equalizer::get_equalizer_settings,
            commands::equalizer::save_equalizer_settings,
            commands::equalizer::list_equalizer_custom_presets,
            commands::equalizer::save_equalizer_custom_preset,
            commands::equalizer::delete_equalizer_custom_preset,
            commands::playback_settings::get_playback_settings,
            commands::playback_settings::save_playback_settings,
            commands::library_settings::get_library_settings,
            commands::library_settings::save_library_settings,
            commands::library_settings::prepare_import_file,
            commands::library_settings::pick_library_folder,
            commands::library_settings::inspect_library_destination,
            commands::library_settings::relocate_library,
            commands::playback_session::get_playback_session,
            commands::playback_session::save_playback_session,
            commands::track_list_preferences::get_track_list_preferences,
            commands::track_list_preferences::save_track_list_preferences,
            commands::skin_preferences::get_skin_preferences,
            commands::skin_preferences::save_skin_preferences,
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
            commands::file_playback::start_file_playback,
            commands::file_playback::pause_file_playback,
            commands::file_playback::resume_file_playback,
            commands::file_playback::seek_file_playback,
            commands::file_playback::stop_file_playback,
            commands::file_playback::ack_file_playback_pcm,
            commands::cd::lookup_disc_metadata,
            commands::cd::peek_disc_metadata_cache,
            commands::cd::save_disc_metadata_preference,
            commands::cd::rip_cd_track,
            commands::cd::cleanup_cd_rip_temp,
            commands::activity_log::append_activity_log,
            commands::activity_log::get_recent_activity_logs,
            commands::activity_log::clear_activity_logs,
            commands::crash_report::list_crash_reports,
            commands::crash_report::read_crash_report,
            commands::crash_report::acknowledge_crash_report,
            commands::diagnostics_export::export_diagnostics,
            commands::diagnostics_export::save_diagnostics_export,
            #[cfg(debug_assertions)]
            commands::crash_report::trigger_test_panic,
            #[cfg(debug_assertions)]
            commands::crash_report::get_crash_reports_dir,
            #[cfg(desktop)]
            media_session::update_media_session,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
