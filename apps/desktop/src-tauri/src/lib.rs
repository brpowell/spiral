mod accessibility_warmup;
mod activity_log;
#[cfg(all(feature = "agent-bridge", debug_assertions, target_os = "macos"))]
mod agent_bridge;
mod app_windows;
mod art_cache;
mod art_thumb;
mod artist_art_fetch;
mod artist_tags;
mod artwork_extract;
mod artwork_organize;
mod artwork_paths;
mod artwork_write;
mod audio_formats;
mod audio_properties;
mod cd;
mod commands;
mod cover_art_fetch;
mod crash_report;
mod db;
mod diagnostics_export;
mod disc_metadata_cache;
mod encoding_profiles;
mod file_playback;
mod file_scan;
mod fs_move;
mod image_crop;
mod import_files;
mod itunes_smpb;
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
mod mbid;
mod mbid_tags;
#[cfg(desktop)]
mod media_session;
#[cfg(desktop)]
mod media_shortcuts;
mod metadata_backup;
pub mod metadata_reader;
mod metadata_writer;
mod models;
mod musicbrainz_disc;
mod musicbrainz_entity;
mod musicbrainz_http;
mod native_audio;
#[cfg(test)]
mod ogg_opus_tests;
mod packs;
mod rating_sync;
mod rating_tags;
mod session;
mod settings;
mod skin_click_through;
pub mod skin_convert;
mod skin_drag;
mod skin_preferences;
pub mod tag_inspector;
#[cfg(test)]
mod test_fixtures;
mod track_list_prefs;
mod transcoder;
mod vorbis_container;
mod wikimedia_http;
pub mod wms_import;
mod zip_import;

/// Outbound HTTP User-Agent. Version tracks Cargo.toml; contact is the product site.
pub(crate) const USER_AGENT: &str = concat!(
    "Spiral/",
    env!("CARGO_PKG_VERSION"),
    " (https://spiralpowered.com)"
);

use commands::library::DbState;
use rating_sync::RatingSync;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;

fn load_dev_dotenv() {
    let candidates = [
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.env"),
        PathBuf::from(".env"),
        PathBuf::from("../.env"),
    ];
    for path in candidates {
        if path.is_file() {
            let _ = dotenvy::from_path(&path);
            return;
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    load_dev_dotenv();

    // Must be registered first on Windows/Linux: a second launch is forwarded to
    // the primary instance, which is focused instead.
    #[cfg(any(windows, target_os = "linux"))]
    let builder =
        tauri::Builder::default().plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }));

    #[cfg(not(any(windows, target_os = "linux")))]
    let builder = tauri::Builder::default();

    let app = builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            #[cfg(all(feature = "agent-bridge", debug_assertions, target_os = "macos"))]
            agent_bridge::start(app.handle().clone());

            app_windows::create_startup_windows(app.handle())
                .map_err(|err| std::io::Error::other(err))?;

            let db_path = library_paths::ensure_library_for_app(app.handle())
                .expect("failed to init library");
            let conn = db::open(&db_path).expect("failed to open database");
            app.manage(DbState(Mutex::new(conn)));
            app.manage(RatingSync::new());

            #[cfg(desktop)]
            if let Err(err) = media_shortcuts::register(app.handle()) {
                eprintln!("failed to register media shortcuts: {err}");
            }

            #[cfg(desktop)]
            media_session::init(app.handle());

            accessibility_warmup::install();

            cd::monitor::start_monitor(app.handle().clone());

            activity_log::init(app.handle().clone());
            crash_report::init(app.handle().clone());

            if let Err(err) = packs::ensure_packs_ready(app.handle()) {
                eprintln!("pack dirs on startup: {err}");
            }

            packs::start_workshop_watch(app.handle().clone());

            if let Err(err) = metadata_backup::purge_legacy_tag_backups(app.handle()) {
                eprintln!("legacy tag backup cleanup on startup: {err}");
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app::quit_app,
            app_windows::ensure_app_window,
            app_windows::release_app_window,
            app_windows::create_skin_aux_window,
            commands::files::pick_audio_files,
            commands::files::pick_library_paths,
            commands::files::scan_folder,
            zip_import::scan_zip_import,
            zip_import::cleanup_zip_import,
            commands::files::pick_folder,
            commands::files::get_file_size,
            commands::files::get_directory_size,
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
            commands::playlists::store_cropped_playlist_art,
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
            commands::metadata::search_musicbrainz_entities,
            commands::metadata::get_musicbrainz_entity,
            commands::metadata::fetch_musicbrainz_entity,
            commands::metadata::clear_metadata_cache,
            commands::artist_images::get_artist_images,
            commands::artist_images::save_artist_image,
            commands::artist_images::rename_artist_image_key,
            commands::metadata::write_track_metadata,
            commands::metadata::rename_album_artwork,
            commands::themes::get_builtin_themes,
            commands::themes::load_user_themes,
            commands::themes::save_active_theme_id,
            commands::themes::get_active_theme_id,
            commands::themes::create_workshop_theme,
            commands::themes::save_workshop_theme,
            commands::items::install_item,
            commands::items::get_item_export_defaults,
            commands::items::export_item,
            commands::items::list_items,
            commands::items::link_item_folder,
            commands::items::unlink_item,
            commands::items::get_item_scan_warnings,
            commands::items::update_item_metadata,
            commands::items::read_item_readme,
            commands::items::write_item_readme,
            commands::items::read_item_changelog,
            commands::items::write_item_changelog,
            commands::items::uninstall_item,
            commands::items::delete_workshop_item,
            commands::items::set_item_hidden,
            commands::items::get_default_author_id,
            commands::items::save_default_author_id,
            commands::registry::get_pack_registries,
            commands::registry::save_pack_registries,
            commands::registry::fetch_pack_catalog,
            commands::registry::fetch_registry_pack,
            commands::registry::fetch_registry_pack_version,
            commands::registry::get_app_version,
            commands::registry::pack_meets_min_app_version,
            commands::registry::is_pack_installed,
            commands::registry::install_pack_from_url,
            commands::registry::install_pack_from_registry,
            commands::registry::resolve_registry_pack_preview,
            commands::registry::cancel_pack_download,
            commands::registry::clear_pack_download_cancel,
            commands::skins::list_skins,
            commands::skins::load_skin_pack,
            commands::skins::save_active_skin_id,
            commands::skins::get_active_skin_id,
            commands::skins::save_active_skin_view,
            commands::skins::get_active_skin_view,
            commands::skins::set_skin_ignore_cursor_events,
            commands::skins::start_skin_window_drag,
            commands::skins::get_skin_cursor_client_position,
            commands::sounds::resolve_sound_asset,
            commands::wms_import::import_wms_skin,
            commands::visualizers::list_visualizers,
            commands::visualizers::load_visualizer,
            commands::visualizers::read_viz_layer_source,
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
            commands::cd::set_cd_playback_gain,
            commands::cd::set_cd_playback_balance,
            commands::cd::ramp_cd_playback_gain,
            commands::cd::link_cd_gapless_playback,
            commands::file_playback::start_file_playback,
            commands::file_playback::pause_file_playback,
            commands::file_playback::resume_file_playback,
            commands::file_playback::seek_file_playback,
            commands::file_playback::stop_file_playback,
            commands::file_playback::set_file_playback_gain,
            commands::file_playback::link_gapless_playback,
            commands::file_playback::set_file_playback_balance,
            commands::file_playback::ramp_file_playback_gain,
            commands::file_playback::set_native_equalizer,
            commands::file_playback::start_native_analyser,
            commands::file_playback::stop_native_analyser,
            commands::file_playback::load_sfx,
            commands::file_playback::play_sfx,
            commands::cd::lookup_disc_metadata,
            commands::cd::peek_disc_metadata_cache,
            commands::cd::save_disc_metadata_preference,
            commands::cd::get_disc_metadata_override,
            commands::cd::save_disc_metadata_override,
            commands::cd::clear_disc_metadata_override,
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
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|_app, _event| {});
}
