use crate::art_cache;
use crate::audio_properties;
use crate::db;
use crate::encoding_profiles;
use crate::fs_move;
use crate::fs_probe::{self, Probed};
use crate::ids::TrackId;
use crate::import_files;
use crate::library_organize::{self, OrganizeMetadata};
use crate::lyrics_normalize;
use crate::lyrics_sidecar;
use crate::metadata_reader;
use crate::metadata_writer;
use crate::models::{
    ClearListenHistoryResult, ListenEventInput, RecordListenEventResult,
    RefreshLibraryMetadataResult, Track, TrackInput, TrackLyricsInput, TrackMetadataUpdate,
};
use crate::popularity::{self, PopularityParams, TrackPopularity};
use crate::rating_sync::{schedule_rating_file_write, RatingSync};
use crate::settings;
use crate::sources::{self, LibraryRoots};
use crate::track_identity;
use crate::transcoder;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

pub struct DbState(pub Mutex<rusqlite::Connection>);

fn library_root(app: &AppHandle) -> PathBuf {
    PathBuf::from(settings::resolved_library_settings(app).library_root)
}

/// Load a track row and resolve `art_path` to an absolute display path for the UI.
pub(crate) fn track_for_ui(
    conn: &rusqlite::Connection,
    library_root: &Path,
    track_id: &TrackId,
) -> Result<Track, String> {
    let mut track = db::get_track_by_id(conn, track_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Track {track_id} not found"))?;
    crate::artwork_paths::hydrate_track_art_path(conn, library_root, &mut track);
    Ok(track)
}

fn track_input_to_metadata(input: &TrackInput) -> TrackMetadataUpdate {
    TrackMetadataUpdate {
        title: input.title.clone(),
        artist: input.artist.clone(),
        album: input.album.clone(),
        album_artist: input.album_artist.clone(),
        track_number: input.track_number,
        total_tracks: input.total_tracks,
        disc_number: input.disc_number,
        total_discs: input.total_discs,
        year: input.year,
        genre: input.genre.clone(),
        art_path: input.art_path.clone(),
        art_changed: false,
        lyrics: None,
        lyrics_changed: false,
        recording_mbid: input.recording_mbid.clone(),
        release_mbid: input.release_mbid.clone(),
        artist_mbids: input.artist_mbids.clone(),
        album_artist_mbids: input.album_artist_mbids.clone(),
    }
}

fn track_to_metadata(track: &Track) -> TrackMetadataUpdate {
    TrackMetadataUpdate {
        title: track.title.clone(),
        artist: track.artist.clone(),
        album: track.album.clone(),
        album_artist: track.album_artist.clone(),
        track_number: track.track_number,
        total_tracks: track.total_tracks,
        disc_number: track.disc_number,
        total_discs: track.total_discs,
        year: track.year,
        genre: track.genre.clone(),
        art_path: track.art_path.clone(),
        art_changed: false,
        lyrics: None,
        lyrics_changed: false,
        recording_mbid: track.recording_mbid.clone(),
        release_mbid: track.release_mbid.clone(),
        artist_mbids: track.artist_mbids.clone(),
        album_artist_mbids: track.album_artist_mbids.clone(),
    }
}

fn track_to_input(track: &Track, file_path: String) -> TrackInput {
    let audio = audio_properties::read_audio_properties(Path::new(&file_path));
    TrackInput {
        title: track.title.clone(),
        artist: track.artist.clone(),
        album: track.album.clone(),
        album_artist: track.album_artist.clone(),
        track_number: track.track_number,
        total_tracks: track.total_tracks,
        disc_number: track.disc_number,
        total_discs: track.total_discs,
        year: track.year,
        genre: track.genre.clone(),
        duration_seconds: track.duration_seconds,
        sample_rate: audio.sample_rate,
        bitrate: audio.bitrate,
        codec: audio.codec,
        file_path,
        art_path: track.art_path.clone(),
        rating: Some(track.rating),
        lyrics: None,
        recording_mbid: track.recording_mbid.clone(),
        release_mbid: track.release_mbid.clone(),
        artist_mbids: track.artist_mbids.clone(),
        album_artist_mbids: track.album_artist_mbids.clone(),
        staged_front: None,
    }
}

/// Resolve cover art on disk for embedding into a converted file.
fn resolve_convert_art_path(
    app: &AppHandle,
    track: &Track,
    source: &Path,
) -> Result<Option<String>, String> {
    if let Some(art_path) = &track.art_path {
        if Path::new(art_path).is_file() {
            return Ok(Some(art_path.clone()));
        }
    }

    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;

    if let Some(cached) = art_cache::find_cached_art_path(&app_data, &track.file_path) {
        return Ok(Some(cached.to_string_lossy().into_owned()));
    }

    let source_path = source.to_string_lossy();
    match metadata_reader::parse_track_metadata(
        &app_data,
        source_path.as_ref(),
        settings::lyrics_sidecar_sync_enabled(app),
    ) {
        Ok(input) => Ok(input.art_path),
        Err(_) => Ok(None),
    }
}

fn metadata_for_convert(
    app: &AppHandle,
    track: &Track,
    source: &Path,
) -> Result<TrackMetadataUpdate, String> {
    let mut metadata = track_to_metadata(track);
    if let Some(art_path) = resolve_convert_art_path(app, track, source)? {
        metadata.art_path = Some(art_path);
        metadata.art_changed = true;
    }
    Ok(metadata)
}

/// Fill codec / sample rate / bitrate from the file when the client omitted them
/// (e.g. CD rip builds tags without re-probing the encoded file).
fn fill_missing_audio_properties(track: &mut TrackInput) {
    if track.sample_rate.is_some() && track.bitrate.is_some() && track.codec.is_some() {
        return;
    }
    let audio = audio_properties::read_audio_properties(Path::new(&track.file_path));
    if track.sample_rate.is_none() {
        track.sample_rate = audio.sample_rate;
    }
    if track.bitrate.is_none() {
        track.bitrate = audio.bitrate;
    }
    if track.codec.is_none() {
        track.codec = audio.codec;
    }
}

#[tauri::command]
pub fn save_track(
    app: AppHandle,
    state: State<DbState>,
    mut track: TrackInput,
) -> Result<Track, String> {
    fill_missing_audio_properties(&mut track);
    let library = settings::resolved_library_settings(&app);
    let root = PathBuf::from(&library.library_root);
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    // The file was copied into a source, or is already in one.
    let source_id = sources::require_source_for_path(
        &conn,
        &LibraryRoots::from_settings(&library),
        Path::new(&track.file_path),
    )?;
    // Importing a file on purpose brings back one the user removed earlier.
    if let Ok(rel_path) = sources::SourceRoots::load(&conn)
        .map_err(|e| e.to_string())
        .and_then(|roots| roots.relative_path(source_id, Path::new(&track.file_path)))
    {
        db::clear_removed_track(&conn, source_id, &rel_path).map_err(|e| e.to_string())?;
    }
    let id = db::save_track(&conn, &track, source_id).map_err(|e| {
        eprintln!("save_track error: {e}");
        e.to_string()
    })?;
    lyrics_normalize::persist_import_lyrics(&conn, &id, &track.lyrics).map_err(|e| {
        eprintln!("persist_import_lyrics error: {e}");
        e.to_string()
    })?;
    // Front art is what the file embeds (an import's own picture, or the art a
    // CD rip wrote into it); `art_path` stands in only for a file with none.
    crate::artwork_extract::link_front_from_file(
        &conn,
        &root,
        &crate::artwork_extract::FrontTarget::of_input(&id, &track),
        Path::new(&track.file_path),
        track.art_path.as_deref().map(Path::new),
    )?;
    track_for_ui(&conn, &root, &id)
}

#[tauri::command]
pub fn get_library(app: AppHandle, state: State<DbState>) -> Result<Vec<Track>, String> {
    let library_root = library_root(&app);
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut tracks = db::get_all_tracks(&conn).map_err(|e| {
        eprintln!("get_library error: {e}");
        e.to_string()
    })?;
    crate::artwork_paths::hydrate_tracks_art_paths(&conn, &library_root, &mut tracks);
    Ok(tracks)
}

const REFRESH_METADATA_MAX_ERRORS: usize = 20;

fn refresh_library_metadata_blocking(
    app: &AppHandle,
) -> Result<RefreshLibraryMetadataResult, String> {
    let library_root = PathBuf::from(settings::resolved_library_settings(app).library_root);
    let state = app.state::<DbState>();
    let tracks = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        db::get_all_tracks(&conn).map_err(|e| {
            eprintln!("refresh_library_metadata get_all_tracks error: {e}");
            e.to_string()
        })?
    };

    let mut updated = 0u32;
    let mut missing = 0u32;
    let mut failed = 0u32;
    let mut errors = Vec::new();

    for track in tracks {
        let label = if track.title.is_empty() {
            track.file_path.clone()
        } else {
            track.title.clone()
        };

        if !Path::new(&track.file_path).is_file() {
            missing += 1;
            if errors.len() < REFRESH_METADATA_MAX_ERRORS {
                errors.push(format!("{label}: File not found"));
            }
            continue;
        }

        let lyrics_sidecar_enabled = settings::lyrics_sidecar_sync_enabled(app);
        // Art is reconstructed per album after all tracks are read.
        let parse_result =
            metadata_reader::read_track_metadata(&track.file_path, lyrics_sidecar_enabled);
        let input = match parse_result {
            Ok(parsed) => parsed.input,
            Err(err) => {
                failed += 1;
                if errors.len() < REFRESH_METADATA_MAX_ERRORS {
                    errors.push(format!("{label}: {err}"));
                }
                continue;
            }
        };
        let save_result = {
            let conn = state.0.lock().map_err(|e| e.to_string())?;
            db::save_track(&conn, &input, track.source_id)
        };

        match save_result {
            Ok(_) => updated += 1,
            Err(err) => {
                failed += 1;
                if errors.len() < REFRESH_METADATA_MAX_ERRORS {
                    errors.push(format!("{label}: {err}"));
                }
            }
        }
    }

    {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        if let Err(err) =
            crate::artwork_extract::reconstruct_all_album_artwork(&conn, &library_root)
        {
            eprintln!("refresh reconstruct artwork: {err}");
            if errors.len() < REFRESH_METADATA_MAX_ERRORS {
                errors.push(format!("Artwork rebuild: {err}"));
            }
            failed = failed.saturating_add(1);
        }
    }

    Ok(RefreshLibraryMetadataResult {
        updated,
        missing,
        failed,
        errors,
    })
}

#[tauri::command]
pub async fn refresh_library_metadata(
    app: AppHandle,
) -> Result<RefreshLibraryMetadataResult, String> {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || refresh_library_metadata_blocking(&app))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn record_listen_event(
    app: AppHandle,
    state: State<DbState>,
    event: ListenEventInput,
) -> Result<RecordListenEventResult, String> {
    let mut conn = state.0.lock().map_err(|e| e.to_string())?;
    if !settings::listening_history_enabled(&app) {
        return db::skip_listen_event_recording(&conn, &event.track_id).map_err(|e| {
            eprintln!("skip_listen_event_recording error: {e}");
            e.to_string()
        });
    }
    db::record_listen_event(&mut conn, &event).map_err(|e| {
        eprintln!("record_listen_event error: {e}");
        e.to_string()
    })
}

#[tauri::command]
pub fn clear_listen_history(
    state: State<DbState>,
    within_hours: Option<u32>,
) -> Result<ClearListenHistoryResult, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::clear_listen_events(&conn, within_hours).map_err(|e| {
        eprintln!("clear_listen_history error: {e}");
        e.to_string()
    })
}

/// Time-decayed listening score per track, highest first. Tracks with no positive score are
/// omitted. All params are optional; see `popularity::PopularityParams` for defaults.
#[tauri::command]
pub fn get_track_popularity(
    state: State<DbState>,
    params: Option<PopularityParams>,
) -> Result<Vec<TrackPopularity>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    popularity::track_popularity(&conn, &params.unwrap_or_default(), chrono::Utc::now()).map_err(
        |e| {
            eprintln!("get_track_popularity error: {e}");
            e.to_string()
        },
    )
}

#[tauri::command]
pub fn set_track_rating(
    app: AppHandle,
    state: State<DbState>,
    rating_sync: State<RatingSync>,
    track_id: TrackId,
    rating: u8,
) -> Result<u8, String> {
    let track_id = &track_id;
    let (saved_rating, file_path) = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        save_rating(&conn, track_id, rating)?
    };

    schedule_rating_file_write(app, &rating_sync, track_id, file_path, saved_rating);

    Ok(saved_rating)
}

/// Save a rating in the library. Returns the saved rating and the file to
/// write the rating tag to.
fn save_rating(
    conn: &rusqlite::Connection,
    track_id: &TrackId,
    rating: u8,
) -> Result<(u8, String), String> {
    let saved_rating = db::set_track_rating(conn, track_id, rating).map_err(|e| {
        eprintln!("set_track_rating error: {e}");
        e.to_string()
    })?;
    let file_path = db::get_track_by_id(conn, track_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Track {track_id} not found after rating update"))?
        .file_path;
    Ok((saved_rating, file_path))
}

/// What became of a removed track's file.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RemovedFile {
    /// Only the row was removed, as asked.
    NotRequested,
    /// Moved to the Trash.
    Trashed,
    /// Nothing was at the track's path.
    NotFound,
    /// The track was marked missing, so its path can't be trusted to name
    /// its own file (it may be another track's, under another spelling).
    KeptMissing,
    /// Another track still uses the file.
    KeptShared,
    /// The file's folder didn't answer (an unplugged drive, a dropped
    /// share), so whether the file is there is unknown. It is left alone and
    /// stays remembered as removed, so a later rescan doesn't add it back.
    KeptUnreachable,
}

#[tauri::command(async)]
pub fn remove_track(
    app: AppHandle,
    state: State<DbState>,
    track_id: TrackId,
    delete_from_disk: bool,
) -> Result<RemovedFile, String> {
    let track_id = &track_id;
    let sidecar_enabled = settings::lyrics_sidecar_sync_enabled(&app);
    let (track, file) =
        remove_track_and_file(&state.0, track_id, delete_from_disk, sidecar_enabled)?;

    let library_root = PathBuf::from(settings::resolved_library_settings(&app).library_root);

    if let Ok(app_data) = app.path().app_data_dir() {
        let _ = art_cache::remove_cached_art(&app_data, &track.file_path);
    }

    {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        // Its art links went with its row; drop images nothing else shows.
        if let Err(err) = crate::artwork_registry::prune(&conn, &library_root) {
            eprintln!("artwork prune after remove_track: {err}");
        }
    }

    Ok(file)
}

/// Remove a track's row and, when asked, its file. The database is only
/// locked around database work: the file sits in a source folder that may be
/// on a network share, and a call that stalls on it while holding the lock
/// would freeze every library command.
fn remove_track_and_file(
    db: &Mutex<rusqlite::Connection>,
    track_id: &TrackId,
    delete_from_disk: bool,
    sidecar_enabled: bool,
) -> Result<(Track, RemovedFile), String> {
    let (track, remembered, removal) = {
        let conn = db.lock().map_err(|e| e.to_string())?;
        let track = db::get_track_by_id(&conn, track_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Track {track_id} not found"))?;
        // The file may stay on disk, so remember it as removed first: rescanning
        // its source then doesn't add it back, even when trashing it fails.
        // A track marked missing has no file to remember.
        let remembered = if track.missing_since.is_some() {
            db::delete_track(&conn, track_id)
                .map(|_| None)
                .map_err(|e| e.to_string())?
        } else {
            db::delete_track_keep_excluded(&conn, track_id).map_err(|e| e.to_string())?
        };
        let removal = if delete_from_disk {
            Some(plan_file_removal(&conn, &track).map_err(|e| e.to_string())?)
        } else {
            None
        };
        (track, remembered, removal)
    };

    let file = match removal {
        None => RemovedFile::NotRequested,
        Some(None) => RemovedFile::KeptMissing,
        Some(Some(plan)) => remove_file_from_disk(&plan, sidecar_enabled)?,
    };

    // The file is gone, so there is nothing left to skip. Only when that is
    // known: a folder that didn't answer keeps the file remembered.
    if let (Some(rel_path), RemovedFile::Trashed | RemovedFile::NotFound) = (&remembered, file) {
        let conn = db.lock().map_err(|e| e.to_string())?;
        if let Err(err) = db::clear_removed_track(&conn, track.source_id, rel_path) {
            eprintln!("clear removed track after trashing: {err}");
        }
    }
    Ok((track, file))
}

/// What deleting a removed track's file needs, read from the database so the
/// disk can be looked at after its lock is released.
#[derive(Debug)]
struct FileRemoval {
    audio_path: PathBuf,
    /// The track's source folder, checked first so a folder that isn't
    /// answering isn't taken to mean the file is gone.
    source_root: Option<PathBuf>,
    /// Other rows whose file name matches, confirmed on disk before trashing.
    namesakes: Vec<(TrackId, PathBuf)>,
}

/// `None` when the track was marked missing: its path can't be trusted to name
/// its own file (it may be another track's, under another spelling), so the
/// file is kept. Reads only the database.
fn plan_file_removal(
    conn: &rusqlite::Connection,
    track: &Track,
) -> rusqlite::Result<Option<FileRemoval>> {
    if track.missing_since.is_some() {
        return Ok(None);
    }
    let audio_path = PathBuf::from(&track.file_path);
    let source_root = sources::SourceRoots::load(conn)?
        .root(track.source_id)
        .map(Path::to_path_buf);
    let namesakes = track_identity::rows_named_like(conn, &audio_path, &track.id)?;
    Ok(Some(FileRemoval {
        audio_path,
        source_root,
        namesakes,
    }))
}

/// Move a removed track's file and lyrics sidecar to the Trash. The file is
/// kept when another track row names the same file (compared on disk, not by
/// path string), and when its folder doesn't answer. Never call this while
/// holding the database lock.
fn remove_file_from_disk(plan: &FileRemoval, sidecar_enabled: bool) -> Result<RemovedFile, String> {
    if let Some(root) = &plan.source_root {
        if !fs_probe::probe_dir_before_use(root).is_yes() {
            return Ok(RemovedFile::KeptUnreachable);
        }
    }
    let audio_path = plan.audio_path.as_path();
    match fs_probe::probe_file_before_use(audio_path) {
        Probed::Yes => {}
        Probed::Stalled => return Ok(RemovedFile::KeptUnreachable),
        Probed::No => {
            if !confirmed_absent(audio_path) {
                return Ok(RemovedFile::KeptUnreachable);
            }
            if sidecar_enabled {
                trash_sidecar(audio_path)?;
            }
            return Ok(RemovedFile::NotFound);
        }
    }
    if !track_identity::same_file_rows(&plan.namesakes, audio_path).is_empty() {
        return Ok(RemovedFile::KeptShared);
    }
    if sidecar_enabled {
        trash_sidecar(audio_path)?;
    }
    fs_move::move_to_trash(audio_path)?;
    Ok(RemovedFile::Trashed)
}

/// Whether nothing is at `path`, as the filesystem says outright. An error
/// other than "not found", or no answer in time, isn't taken as absence.
fn confirmed_absent(path: &Path) -> bool {
    let owned = path.to_path_buf();
    match fs_probe::run_within(fs_probe::ACCESS_TIMEOUT, move || {
        fs::symlink_metadata(&owned)
    }) {
        // Something that isn't a regular file (a folder, a dangling link) is
        // no track's file either.
        Some(Ok(meta)) => !meta.is_file(),
        Some(Err(err)) => err.kind() == std::io::ErrorKind::NotFound,
        None => false,
    }
}

fn trash_sidecar(audio_path: &Path) -> Result<(), String> {
    let sidecar = lyrics_sidecar::sidecar_path_for(audio_path);
    if sidecar.is_file() {
        fs_move::move_to_trash(&sidecar)?;
    }
    Ok(())
}

/// Where a replacement or converted file for `track` goes: its own source.
/// Organized sources build the path from the root; others keep the old
/// file's folder.
fn replacement_destination(
    conn: &rusqlite::Connection,
    track: &Track,
) -> Result<(sources::WriteTarget, PathBuf), String> {
    let target = sources::write_target(conn, track.source_id)?;
    let old_path = Path::new(&track.file_path);
    let folder = match (&target.path_format, old_path.parent()) {
        (None, Some(parent)) => parent.to_path_buf(),
        _ => target.root.clone(),
    };
    Ok((target, folder))
}

/// Move the file a replace or convert superseded to the Trash, with its
/// lyrics sidecar. A file another track row still names stays on disk.
fn remove_superseded_file(
    conn: &rusqlite::Connection,
    track_id: &TrackId,
    source_root: Option<&Path>,
    old_path: &Path,
    sidecar_enabled: bool,
) {
    if !old_path.is_file() {
        return;
    }
    match track_identity::other_rows_for_file(conn, old_path, track_id) {
        Ok(sharing) if sharing.is_empty() => {}
        Ok(_) => return,
        Err(e) => {
            eprintln!("failed to check who else uses a superseded file: {e}");
            return;
        }
    }
    if sidecar_enabled {
        if let Err(e) = trash_sidecar(old_path) {
            eprintln!("failed to remove superseded lyrics sidecar: {e}");
        }
    }
    if let Err(e) = fs_move::move_to_trash(old_path) {
        eprintln!("failed to delete superseded file: {e}");
        return;
    }
    if let (Some(parent), Some(root)) = (old_path.parent(), source_root) {
        library_organize::prune_empty_dirs(parent, root);
    }
}

/// How a replace takes the incoming file.
#[derive(Debug, PartialEq, Eq)]
enum ReplaceWith {
    /// It is the track's own file: nothing to replace.
    SameFile,
    /// It is already in a source: the track points at it where it is, as an
    /// import keeps files that are already in a source in place.
    InPlace,
    /// It is outside every source: copied into the track's own source.
    Copy,
}

fn replace_with(
    conn: &rusqlite::Connection,
    roots: &LibraryRoots,
    old_path: &Path,
    incoming: &Path,
) -> Result<ReplaceWith, String> {
    if track_identity::same_file(old_path, incoming) {
        return Ok(ReplaceWith::SameFile);
    }
    Ok(
        match sources::source_for_path(conn, roots, incoming).map_err(|e| e.to_string())? {
            Some(_) => ReplaceWith::InPlace,
            None => ReplaceWith::Copy,
        },
    )
}

/// Point track `track_id` at its replacement file `new_path`, with the
/// incoming file's tags, in one transaction. With `merge`, a row the file
/// already has (its source was scanned) is merged into the track first, so
/// the track keeps its id, playlists and history and gains the other row's.
/// Returns the track's lyrics as stored, to project onto the file.
fn adopt_replacement(
    conn: &rusqlite::Connection,
    roots: &LibraryRoots,
    track_id: &TrackId,
    new_path: &Path,
    merge: bool,
    metadata: &TrackMetadataUpdate,
    lyrics: &Option<TrackLyricsInput>,
) -> Result<Option<TrackLyricsInput>, String> {
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    if merge {
        for other in track_identity::other_rows_for_file(&tx, new_path, track_id)
            .map_err(|e| e.to_string())?
        {
            track_identity::merge_into(&tx, track_id, &other).map_err(|e| e.to_string())?;
        }
    }
    db::update_track(
        &tx,
        track_id,
        metadata,
        Some(&new_path.to_string_lossy()),
        Some(&audio_properties::read_audio_properties(new_path)),
    )
    .map_err(|e| {
        eprintln!("replace_track_from_import update error: {e}");
        e.to_string()
    })?;
    let source_id = sources::require_source_for_path(&tx, roots, new_path)?;
    db::set_track_source(&tx, track_id, source_id).map_err(|e| e.to_string())?;
    // The new file's picture is the track's front art now.
    crate::artwork_extract::link_front_from_file(
        &tx,
        &roots.library_root,
        &crate::artwork_extract::FrontTarget {
            track_id,
            album_artist: metadata.album_artist.as_deref(),
            artist: metadata.artist.as_deref(),
            album: metadata.album.as_deref(),
            title: &metadata.title,
            track_number: metadata.track_number,
        },
        new_path,
        metadata.art_path.as_deref().map(Path::new),
    )?;
    // The file is there: whatever went missing before is found.
    tx.execute(
        "UPDATE tracks SET missing_since = NULL WHERE id = ?1",
        [track_id],
    )
    .map_err(|e| e.to_string())?;
    lyrics_normalize::persist_import_lyrics(&tx, track_id, lyrics).map_err(|e| {
        eprintln!("persist_import_lyrics error: {e}");
        e.to_string()
    })?;
    let stored = db::get_track_lyrics(&tx, track_id)
        .map_err(|e| e.to_string())?
        .map(lyrics_normalize::track_lyrics_record_to_input);
    tx.commit().map_err(|e| e.to_string())?;
    Ok(stored)
}

/// Replace a track's file with an imported one, keeping the track (its id,
/// playlists and history). A file already in a source is used where it is;
/// one from elsewhere is copied into the track's own source. The superseded
/// file goes to the Trash.
///
/// Checking the path and copying it can be slow over a network source; keep
/// it off the main thread.
#[tauri::command]
pub async fn replace_track_from_import(
    app: AppHandle,
    track_id: TrackId,
    source_path: String,
    track: TrackInput,
) -> Result<Track, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<DbState>();
        let source_path = crate::path_scope::ensure_allowed(&app, &source_path)?
            .to_string_lossy()
            .into_owned();
        let resolved = settings::resolved_library_settings(&app);
        replace_track_file(
            &state.0,
            &LibraryRoots::from_settings(&resolved),
            &track_id,
            Path::new(&source_path),
            &track,
            settings::lyrics_sidecar_sync_enabled(&app),
            app.path().app_data_dir().ok().as_deref(),
        )?;
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        track_for_ui(&conn, Path::new(&resolved.library_root), &track_id)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// [`replace_track_from_import`] without the app: `app_data` holds the art
/// cache to carry over, when there is one.
fn replace_track_file(
    db: &Mutex<rusqlite::Connection>,
    roots: &LibraryRoots,
    track_id: &TrackId,
    incoming: &Path,
    track: &TrackInput,
    sidecar_enabled: bool,
    app_data: Option<&Path>,
) -> Result<(), String> {
    let (existing, metadata, copy_to, old_root) = {
        let conn = db.lock().map_err(|e| e.to_string())?;
        let existing = db::get_track_by_id(&conn, track_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Track {track_id} not found"))?;
        let copy_to = match replace_with(&conn, roots, Path::new(&existing.file_path), incoming)? {
            ReplaceWith::SameFile => return Ok(()),
            ReplaceWith::InPlace => None,
            ReplaceWith::Copy => Some(replacement_destination(&conn, &existing)?),
        };
        let old_root = sources::SourceRoots::load(&conn)
            .map_err(|e| e.to_string())?
            .root(existing.source_id)
            .map(Path::to_path_buf);
        (existing, track_input_to_metadata(track), copy_to, old_root)
    };

    let old_path = PathBuf::from(&existing.file_path);
    let new_path = match &copy_to {
        None => incoming.to_path_buf(),
        Some((target, folder)) => PathBuf::from(import_files::prepare_import_file(
            &incoming.to_string_lossy(),
            import_files::ImportDestination {
                folder,
                path_format: target.path_format.as_deref(),
            },
            sidecar_enabled,
            Some(&old_path),
        )?),
    };

    if let Some(app_data) = app_data {
        library_organize::migrate_art_cache(
            app_data,
            &existing.file_path,
            &new_path.to_string_lossy(),
        )?;
    }

    let canonical_lyrics = {
        let conn = db.lock().map_err(|e| e.to_string())?;
        adopt_replacement(
            &conn,
            roots,
            track_id,
            &new_path,
            copy_to.is_none(),
            &metadata,
            &track.lyrics,
        )?
    };

    // A copy is Spiral's own file, so it takes the track's lyrics. A file used
    // in place is the user's: writing into it is a tag edit, which goes
    // through the edit's confirmation, so it keeps its own lyrics here (the
    // library keeps the track's).
    if copy_to.is_some() {
        project_lyrics_to_file(&new_path, canonical_lyrics.as_ref(), sidecar_enabled)?;
    }

    let conn = db.lock().map_err(|e| e.to_string())?;
    // Never the file the track now uses, whatever path names it.
    if !library_organize::same_path(&old_path, &new_path)
        && !track_identity::same_file(&old_path, &new_path)
    {
        remove_superseded_file(
            &conn,
            track_id,
            old_root.as_deref(),
            &old_path,
            sidecar_enabled,
        );
    }
    Ok(())
}

/// Project canonical DB lyrics onto an audio file (tags + sidecar).
pub(crate) fn project_lyrics_to_file(
    new_path: &Path,
    lyrics: Option<&TrackLyricsInput>,
    sidecar_enabled: bool,
) -> Result<(), String> {
    match metadata_writer::write_lyrics_projection(new_path, lyrics) {
        Ok(()) => {}
        Err(metadata_writer::MetadataWriteError::UnsupportedFormat(msg)) => {
            eprintln!("replace lyrics projection skipped: {msg}");
        }
        Err(err) => return Err(err.into_message()),
    }

    if sidecar_enabled {
        lyrics_sidecar::sync_sidecar(new_path, lyrics)?;
    }

    Ok(())
}

fn build_convert_dest_path(
    source: &Path,
    track: &Track,
    profile: &encoding_profiles::EncodingProfile,
    folder: &Path,
    path_format: Option<&str>,
) -> Result<PathBuf, String> {
    if let Some(organize_path_format) = path_format {
        let placeholder_name = format!("placeholder.{}", profile.extension);
        let placeholder = Path::new(&placeholder_name);
        let meta = OrganizeMetadata {
            title: track.title.as_str(),
            artist: track.artist.as_deref(),
            album: track.album.as_deref(),
            album_artist: track.album_artist.as_deref(),
            track_number: track.track_number,
            disc_number: track.disc_number,
            year: track.year,
            genre: track.genre.as_deref(),
        };
        library_organize::build_organized_path(folder, placeholder, &meta, organize_path_format)
    } else {
        let stem = source
            .file_stem()
            .and_then(|value| value.to_str())
            .filter(|value| !value.is_empty())
            .unwrap_or("track");
        Ok(folder.join(format!("{stem}.{}", profile.extension)))
    }
}

/// Write under the destination source's folder so the final relocate is
/// same-volume when possible (`std::env::temp_dir()` is often a different
/// mount on Linux, e.g. tmpfs `/tmp`). Scans and watchers skip hidden folders.
fn convert_temp_path(source_root: &Path, track_id: &TrackId, extension: &str) -> PathBuf {
    source_root
        .join(".spiral-convert")
        .join(format!("{track_id}.{extension}"))
}

#[tauri::command]
pub async fn convert_track(
    app: AppHandle,
    track_id: TrackId,
    profile_id: String,
    mode: String,
) -> Result<Track, String> {
    tauri::async_runtime::spawn_blocking(move || {
        convert_track_impl(&app, &track_id, &profile_id, &mode)
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub fn get_convert_profile_options(
    source_paths: Vec<String>,
) -> Result<encoding_profiles::ConvertProfileOptions, String> {
    let paths: Vec<PathBuf> = source_paths.into_iter().map(PathBuf::from).collect();
    encoding_profiles::convert_profile_options_for_sources(&paths)
}

fn convert_track_impl(
    app: &AppHandle,
    track_id: &TrackId,
    profile_id: &str,
    mode: &str,
) -> Result<Track, String> {
    if mode != "replace" && mode != "add_new" {
        return Err(format!("Invalid convert mode: {mode}"));
    }

    let state = app.state::<DbState>();

    let profile = encoding_profiles::profile_from_id(profile_id)?;
    let resolved = settings::resolved_library_settings(app);

    // The converted file goes into the track's own source, organized the way
    // that source is.
    let (existing, target, folder, old_root) = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        let mut existing = db::get_track_by_id(&conn, track_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Track {track_id} not found"))?;
        crate::artwork_paths::hydrate_track_art_path(
            &conn,
            Path::new(&resolved.library_root),
            &mut existing,
        );
        let (target, folder) = replacement_destination(&conn, &existing)?;
        let old_root = sources::SourceRoots::load(&conn)
            .map_err(|e| e.to_string())?
            .root(existing.source_id)
            .map(Path::to_path_buf);
        (existing, target, folder, old_root)
    };

    let source = PathBuf::from(&existing.file_path);
    if !source.is_file() {
        return Err(format!("Source file not found: {}", source.display()));
    }

    if encoding_profiles::source_matches_profile(&source, profile.id) {
        return Err(format!(
            "Track is already {} ({})",
            profile.label, profile.extension
        ));
    }

    if !encoding_profiles::can_convert_to_profile(&source, profile.id) {
        return Err("Cannot convert lossy audio to a lossless format".to_string());
    }

    let target_root = target.root.as_path();
    fs::create_dir_all(target_root)
        .map_err(|err| format!("Failed to create media folder: {err}"))?;

    let dest_path = build_convert_dest_path(
        &source,
        &existing,
        profile,
        &folder,
        target.path_format.as_deref(),
    )?;

    let temp_path = convert_temp_path(target_root, track_id, profile.extension);
    if let Some(parent) = temp_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("Failed to create convert temp folder: {err}"))?;
    }
    if temp_path.exists() {
        fs::remove_file(&temp_path)
            .map_err(|err| format!("Failed to clear convert temp file: {err}"))?;
    }

    let metadata = metadata_for_convert(app, &existing, &source)?;
    transcoder::transcode_file_with_metadata(&source, &temp_path, profile.id, &metadata)?;

    let final_path = library_organize::move_track_file(
        &temp_path,
        dest_path,
        resolved.lyrics_sidecar_sync_enabled,
    )
    .inspect_err(|_err| {
        let _ = fs::remove_file(&temp_path);
    })?;
    if let Some(parent) = temp_path.parent() {
        library_organize::prune_empty_dirs(parent, target_root);
    }
    let new_path = final_path.to_string_lossy().into_owned();

    if mode == "add_new" {
        let input = track_to_input(&existing, new_path);
        let root = PathBuf::from(&resolved.library_root);
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        let id = db::save_track(&conn, &input, target.source_id).map_err(|e| {
            eprintln!("convert_track save_track error: {e}");
            e.to_string()
        })?;
        crate::artwork_extract::link_front_from_file(
            &conn,
            &root,
            &crate::artwork_extract::FrontTarget::of_input(&id, &input),
            Path::new(&input.file_path),
            existing.art_path.as_deref().map(Path::new),
        )?;
        return track_for_ui(&conn, &root, &id);
    }

    let old_path = PathBuf::from(&existing.file_path);
    let metadata = track_to_metadata(&existing);

    if let Ok(app_data) = app.path().app_data_dir() {
        library_organize::migrate_art_cache(&app_data, &existing.file_path, &new_path)?;
    }

    {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        db::update_track(
            &conn,
            track_id,
            &metadata,
            Some(new_path.as_str()),
            Some(&audio_properties::read_audio_properties(Path::new(
                &new_path,
            ))),
        )
        .map_err(|e| {
            eprintln!("convert_track update error: {e}");
            e.to_string()
        })?;
        db::set_track_source(&conn, track_id, target.source_id).map_err(|e| e.to_string())?;
    }

    let conn = state.0.lock().map_err(|e| e.to_string())?;
    if !library_organize::same_path(&old_path, &final_path) {
        remove_superseded_file(
            &conn,
            track_id,
            old_root.as_deref(),
            &old_path,
            resolved.lyrics_sidecar_sync_enabled,
        );
    }
    track_for_ui(&conn, Path::new(&resolved.library_root), track_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::Track;

    fn sample_track(file_path: &str) -> Track {
        Track {
            id: TrackId::from("1"),
            title: "Example Song".into(),
            artist: Some("Example Artist".into()),
            album: Some("Example Album".into()),
            album_artist: Some("Example Artist".into()),
            track_number: Some(3),
            total_tracks: None,
            disc_number: None,
            total_discs: None,
            year: Some(2024),
            genre: None,
            duration_seconds: Some(180.0),
            sample_rate: None,
            bitrate: None,
            codec: None,
            file_path: file_path.into(),
            art_path: None,
            date_added: "2026-01-01T00:00:00Z".into(),
            play_count: 0,
            last_played_at: None,
            rating: 0,
            lyrics_format: None,
            ..Default::default()
        }
    }

    #[test]
    fn build_convert_dest_path_uses_profile_extension_in_organize_format() {
        let track = sample_track("/media/Artist/Album/track.flac");
        let profile = encoding_profiles::profile_from_id("apple-aac").unwrap();
        let dest = build_convert_dest_path(
            Path::new("/media/Artist/Album/track.flac"),
            &track,
            profile,
            Path::new("/media"),
            Some("{artist}/{album}/{title}.{ext}"),
        )
        .unwrap();

        assert_eq!(
            dest,
            Path::new("/media")
                .join("Example Artist")
                .join("Example Album")
                .join("Example Song.m4a")
        );
    }

    #[test]
    fn build_convert_dest_path_without_organize_uses_source_stem_and_profile_ext() {
        let track = sample_track("/media/Artist/Album/track.flac");
        let profile = encoding_profiles::profile_from_id("mp3-high").unwrap();
        let dest = build_convert_dest_path(
            Path::new("/media/Artist/Album/track.flac"),
            &track,
            profile,
            Path::new("/media"),
            None,
        )
        .unwrap();

        assert_eq!(dest, Path::new("/media/track.mp3"));
    }

    mod source_files {
        use super::super::*;
        use crate::source_test_support::*;

        #[test]
        fn ratings_are_written_to_every_sources_files() {
            let conn = conn();
            let t = default_source_tracks(&conn);
            for (id, path) in [(t.managed, "/managed/m.mp3"), (t.user, "/user/u.mp3")] {
                let (saved, file) = save_rating(&conn, &id, 80).unwrap();
                assert_eq!(file, path);
                assert_eq!(
                    db::get_track_by_id(&conn, &id).unwrap().unwrap().rating,
                    saved
                );
            }
        }

        fn audio_with_sidecar(dir: &Path, name: &str) -> (PathBuf, PathBuf) {
            let audio = dir.join(format!("{name}.mp3"));
            fs::write(&audio, b"audio").unwrap();
            let sidecar = lyrics_sidecar::sidecar_path_for(&audio);
            fs::write(&sidecar, b"[00:00.00]line\n").unwrap();
            (audio, sidecar)
        }

        fn track_in(conn: &rusqlite::Connection, id: &TrackId) -> Track {
            db::get_track_by_id(conn, id).unwrap().unwrap()
        }

        #[test]
        fn replacements_go_to_the_tracks_own_source() {
            let tmp = TempDir::new("replace-dest");
            let conn = conn();
            let organized = tmp.dir("Organized");
            let loose = tmp.dir("Loose/Sub");
            let organized_id = add_user_source(&conn, &organized);
            let loose_id = add_user_source(&conn, &tmp.0.join("Loose"));
            crate::sources::set_source_organize(&conn, organized_id, true).unwrap();
            let a = insert_track(&conn, "A/a.mp3", organized_id);
            let b = insert_track(&conn, "Sub/b.mp3", loose_id);

            // Organized without its own format: Spiral's built-in one.
            let (target, folder) = replacement_destination(&conn, &track_in(&conn, &a)).unwrap();
            assert_eq!(target.source_id, organized_id);
            assert_eq!(
                target.path_format.as_deref(),
                Some(crate::library_organize::DEFAULT_ORGANIZE_PATH_FORMAT)
            );
            assert_eq!(folder, organized);

            // Its own format wins.
            crate::sources::set_source_path_format(
                &conn,
                organized_id,
                Some("{title}.{ext}".into()),
            )
            .unwrap();
            let (target, _) = replacement_destination(&conn, &track_in(&conn, &a)).unwrap();
            assert_eq!(target.path_format.as_deref(), Some("{title}.{ext}"));

            // Not organized: the replacement lands beside the old file.
            let (target, folder) = replacement_destination(&conn, &track_in(&conn, &b)).unwrap();
            assert_eq!((target.source_id, target.path_format), (loose_id, None));
            assert_eq!(folder, loose);
        }

        #[test]
        fn an_unreachable_source_refuses_replacements() {
            let tmp = TempDir::new("replace-offline");
            let conn = conn();
            let gone = add_user_source(&conn, &tmp.0.join("Unplugged"));
            let u = insert_track(&conn, "u.mp3", gone);
            assert!(replacement_destination(&conn, &track_in(&conn, &u)).is_err());
        }

        /// Remove a track's row the way `remove_track` does, returning it.
        fn remove_row(conn: &rusqlite::Connection, id: &TrackId) -> Track {
            let track = track_in(conn, id);
            db::delete_track(conn, id).unwrap();
            track
        }

        /// The disk half of `remove_track`'s delete, as it runs after the row
        /// is gone and the lock released.
        fn delete_removed_track_file(
            conn: &rusqlite::Connection,
            track: &Track,
            sidecar_enabled: bool,
        ) -> Result<RemovedFile, String> {
            match plan_file_removal(conn, track).unwrap() {
                None => Ok(RemovedFile::KeptMissing),
                Some(plan) => remove_file_from_disk(&plan, sidecar_enabled),
            }
        }

        fn remembered(db: &Mutex<rusqlite::Connection>, source: i64) -> Vec<String> {
            db::removed_tracks(&db.lock().unwrap(), source)
                .unwrap()
                .into_iter()
                .map(|(rel_path, _)| rel_path)
                .collect()
        }

        #[test]
        fn a_trashed_file_is_no_longer_remembered_as_removed() {
            let tmp = TempDir::new("remove-trashed");
            let db = Mutex::new(conn());
            let (audio, sidecar) = audio_with_sidecar(&tmp.0, "song");
            let source = add_user_source(&db.lock().unwrap(), &tmp.0);
            let id = insert_track(&db.lock().unwrap(), "song.mp3", source);

            let (_, file) = remove_track_and_file(&db, &id, true, true).unwrap();
            assert_eq!(file, RemovedFile::Trashed);
            assert!(!audio.exists() && !sidecar.exists());
            assert!(remembered(&db, source).is_empty());
        }

        #[test]
        fn a_file_confirmed_gone_is_no_longer_remembered_as_removed() {
            let tmp = TempDir::new("remove-gone");
            let db = Mutex::new(conn());
            let source = add_user_source(&db.lock().unwrap(), &tmp.0);
            let id = insert_track(&db.lock().unwrap(), "gone.mp3", source);

            let (_, file) = remove_track_and_file(&db, &id, true, true).unwrap();
            assert_eq!(file, RemovedFile::NotFound);
            assert!(remembered(&db, source).is_empty());
        }

        #[test]
        fn a_file_in_an_offline_folder_stays_remembered_as_removed() {
            let tmp = TempDir::new("remove-offline");
            let db = Mutex::new(conn());
            let (audio, sidecar) = audio_with_sidecar(&tmp.0, "song");
            let source = add_user_source(&db.lock().unwrap(), &tmp.0);
            let id = insert_track(&db.lock().unwrap(), "song.mp3", source);

            let started = std::time::Instant::now();
            let (_, file) = {
                let _stall = crate::fs_probe::stall_dir(&tmp.0);
                remove_track_and_file(&db, &id, true, true).unwrap()
            };
            assert!(started.elapsed() < std::time::Duration::from_millis(500));
            assert_eq!(file, RemovedFile::KeptUnreachable);
            assert!(audio.is_file() && sidecar.is_file());
            assert_eq!(remembered(&db, source), ["song.mp3"]);
            assert!(db::get_track_by_id(&db.lock().unwrap(), &id)
                .unwrap()
                .is_none());
        }

        #[test]
        fn a_file_that_stalls_stays_remembered_as_removed() {
            let tmp = TempDir::new("remove-stalled-file");
            let db = Mutex::new(conn());
            let (audio, _) = audio_with_sidecar(&tmp.0, "song");
            let source = add_user_source(&db.lock().unwrap(), &tmp.0);
            let id = insert_track(&db.lock().unwrap(), "song.mp3", source);

            let (_, file) = {
                let _stall = crate::fs_probe::stall_file(&audio);
                remove_track_and_file(&db, &id, true, true).unwrap()
            };
            assert_eq!(file, RemovedFile::KeptUnreachable);
            assert!(audio.is_file());
            assert_eq!(remembered(&db, source), ["song.mp3"]);
        }

        #[test]
        fn removing_only_the_row_keeps_the_file_remembered() {
            let tmp = TempDir::new("remove-row-only");
            let db = Mutex::new(conn());
            let (audio, _) = audio_with_sidecar(&tmp.0, "song");
            let source = add_user_source(&db.lock().unwrap(), &tmp.0);
            let id = insert_track(&db.lock().unwrap(), "song.mp3", source);

            let (_, file) = remove_track_and_file(&db, &id, false, true).unwrap();
            assert_eq!(file, RemovedFile::NotRequested);
            assert!(audio.is_file());
            assert_eq!(remembered(&db, source), ["song.mp3"]);
        }

        #[test]
        fn delete_from_disk_trashes_from_every_source() {
            let tmp = TempDir::new("delete");
            let conn = conn();
            let files: Vec<_> = ["m", "u"]
                .iter()
                .map(|name| audio_with_sidecar(&tmp.dir(name), name))
                .collect();
            let managed = add_managed_source(&conn, &tmp.0.join("m"));
            let user = add_user_source(&conn, &tmp.0.join("u"));
            let ids = [
                insert_track(&conn, "m.mp3", managed),
                insert_track(&conn, "u.mp3", user),
            ];

            for (id, (audio, sidecar)) in ids.iter().zip(&files) {
                let track = remove_row(&conn, id);
                assert_eq!(
                    delete_removed_track_file(&conn, &track, true).unwrap(),
                    RemovedFile::Trashed
                );
                assert!(!audio.exists());
                assert!(!sidecar.exists());
            }
        }

        #[test]
        fn a_missing_tracks_file_is_never_deleted() {
            let tmp = TempDir::new("delete-missing");
            let conn = conn();
            let (audio, sidecar) = audio_with_sidecar(&tmp.0, "song");
            let source = add_user_source(&conn, &tmp.0);
            let id = insert_track(&conn, "song.mp3", source);
            conn.execute(
                "UPDATE tracks SET missing_since = 'then' WHERE id = ?1",
                [&id],
            )
            .unwrap();
            let track = remove_row(&conn, &id);
            assert_eq!(
                delete_removed_track_file(&conn, &track, true).unwrap(),
                RemovedFile::KeptMissing
            );
            assert!(audio.is_file() && sidecar.is_file());
        }

        #[test]
        fn a_file_another_row_names_is_kept() {
            let tmp = TempDir::new("delete-shared");
            let conn = conn();
            let (audio, sidecar) = audio_with_sidecar(&tmp.0, "song");
            // Another row for the same file under another case.
            crate::track_identity::tests::alias(&audio, "SONG.mp3");
            let user = add_user_source(&conn, &tmp.0);
            let a = insert_track(&conn, "song.mp3", user);
            insert_track(&conn, "SONG.mp3", user);

            let track = remove_row(&conn, &a);
            assert_eq!(
                delete_removed_track_file(&conn, &track, true).unwrap(),
                RemovedFile::KeptShared
            );
            assert!(audio.is_file() && sidecar.is_file());

            // The same file is kept when a replace supersedes it.
            remove_superseded_file(&conn, &a, Some(&tmp.0), &audio, true);
            assert!(audio.is_file() && sidecar.is_file());
        }

        mod replace {
            use super::*;
            use std::sync::Mutex;

            /// Sources B (the track's) and A, with the track's file in B and
            /// the incoming file in A.
            struct Library {
                tmp: TempDir,
                db: Mutex<rusqlite::Connection>,
                track: TrackId,
                old: PathBuf,
                incoming: PathBuf,
                a: i64,
            }

            fn library(label: &str) -> Library {
                let tmp = TempDir::new(label);
                let conn = conn();
                let b = add_user_source(&conn, &tmp.dir("B"));
                let a = add_user_source(&conn, &tmp.dir("A"));
                let old = tmp.0.join("B/song.wav");
                let incoming = tmp.0.join("A/new.wav");
                crate::test_fixtures::wav::write_minimal(&old);
                crate::test_fixtures::wav::write_minimal(&incoming);
                let track = insert_track(&conn, "song.wav", b);
                Library {
                    tmp,
                    db: Mutex::new(conn),
                    track,
                    old,
                    incoming,
                    a,
                }
            }

            fn replace(lib: &Library, incoming: &Path) {
                let roots = LibraryRoots::for_library_root(&lib.tmp.0.join("Spiral"));
                let input = TrackInput {
                    title: "New".into(),
                    file_path: incoming.to_string_lossy().into_owned(),
                    ..Default::default()
                };
                replace_track_file(&lib.db, &roots, &lib.track, incoming, &input, true, None)
                    .unwrap();
            }

            fn track_ids(conn: &rusqlite::Connection) -> Vec<TrackId> {
                let mut stmt = conn.prepare("SELECT id FROM tracks ORDER BY id").unwrap();
                stmt.query_map([], |row| row.get(0))
                    .unwrap()
                    .collect::<Result<_, _>>()
                    .unwrap()
            }

            fn files_in(dir: &Path) -> Vec<String> {
                let mut names: Vec<_> = fs::read_dir(dir)
                    .unwrap()
                    .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
                    .collect();
                names.sort();
                names
            }

            #[test]
            fn a_file_already_in_a_source_is_used_where_it_is() {
                let lib = library("replace-in-place");
                let bytes = fs::read(&lib.incoming).unwrap();
                replace(&lib, &lib.incoming);

                let conn = lib.db.lock().unwrap();
                let track = track_in(&conn, &lib.track);
                // The same track, now at A's file: no copy, one row.
                assert_eq!(track_ids(&conn), vec![lib.track.clone()]);
                assert_eq!(Path::new(&track.file_path), lib.incoming);
                assert_eq!(track.source_id, lib.a);
                assert_eq!(track.missing_since, None);
                assert_eq!(track.title, "New");
                // B's superseded file is in the Trash; A's file stays.
                assert!(files_in(&lib.tmp.0.join("B")).is_empty());
                assert_eq!(files_in(&lib.tmp.0.join("A")), vec!["new.wav"]);
                // The user's file isn't written to: no tag edit without its
                // confirmation.
                assert_eq!(fs::read(&lib.incoming).unwrap(), bytes);
            }

            #[test]
            fn a_scanned_files_row_is_merged_into_the_track() {
                let lib = library("replace-merge");
                {
                    let conn = lib.db.lock().unwrap();
                    let scanned = insert_track(&conn, "new.wav", lib.a);
                    conn.execute(
                        "UPDATE tracks SET play_count = 2 WHERE id = ?1",
                        [&lib.track],
                    )
                    .unwrap();
                    conn.execute("UPDATE tracks SET play_count = 3 WHERE id = ?1", [&scanned])
                        .unwrap();
                    let playlist = db::create_playlist(
                        &conn,
                        "Mix",
                        None,
                        crate::models::PlaylistImageMode::Generated,
                        None,
                        None,
                        None,
                    )
                    .unwrap();
                    db::add_tracks_to_playlist(&conn, &playlist, &[scanned]).unwrap();
                }
                replace(&lib, &lib.incoming);

                let conn = lib.db.lock().unwrap();
                // A's row is gone, its plays and playlist entry carried over.
                assert_eq!(track_ids(&conn), vec![lib.track.clone()]);
                let track = track_in(&conn, &lib.track);
                assert_eq!(track.play_count, 5);
                assert_eq!(Path::new(&track.file_path), lib.incoming);
                let in_playlist: i64 = conn
                    .query_row(
                        "SELECT COUNT(*) FROM playlist_tracks WHERE track_id = ?1",
                        [&lib.track],
                        |row| row.get(0),
                    )
                    .unwrap();
                assert_eq!(in_playlist, 1);
                assert!(!lib.old.exists());
            }

            #[test]
            fn the_tracks_own_file_is_left_alone() {
                let lib = library("replace-same-file");
                replace(&lib, &lib.old);

                let conn = lib.db.lock().unwrap();
                let track = track_in(&conn, &lib.track);
                assert_eq!(Path::new(&track.file_path), lib.old);
                assert_eq!(track.title, "Song");
                assert!(lib.old.is_file());
            }

            #[test]
            fn a_file_from_outside_every_source_is_copied_in() {
                let lib = library("replace-copy");
                let outside = lib.tmp.dir("Downloads").join("got.wav");
                crate::test_fixtures::wav::write_minimal(&outside);
                replace(&lib, &outside);

                let conn = lib.db.lock().unwrap();
                let track = track_in(&conn, &lib.track);
                // Copied beside the old file in B, which went to the Trash.
                assert_eq!(Path::new(&track.file_path), lib.tmp.0.join("B/got.wav"));
                assert!(outside.is_file());
                assert_eq!(files_in(&lib.tmp.0.join("B")), vec!["got.wav"]);
                assert_eq!(track_ids(&conn), vec![lib.track.clone()]);
            }
        }

        /// The user's sequence: a folder renamed only in case left a row with
        /// the old spelling; a scan marked it missing and added a duplicate
        /// for the spelling on disk; deleting the "missing" duplicate from
        /// disk then deleted the real file.
        #[cfg(unix)]
        #[test]
        fn a_case_only_rename_neither_duplicates_nor_deletes() {
            use crate::source_scan::{self, ReconcileScope, ScanContext};
            use crate::sources::LibraryRoots;
            use std::sync::Mutex;

            let tmp = TempDir::new("case-rename");
            let root = tmp.dir("Music");
            let album = tmp.dir("Music/Album");
            let file = album.join("a.wav");
            crate::test_fixtures::wav::write_minimal(&file);
            crate::track_identity::tests::alias_dir(&album, "ALBUM");
            let db = Mutex::new(conn());
            let lock = || db.lock().unwrap();
            let source = add_user_source(&lock(), &root);
            let id = insert_track(&lock(), "ALBUM/a.wav", source);
            db::set_track_rating(&lock(), &id, 80).unwrap();
            let ctx = ScanContext {
                app_data_dir: tmp.0.join("AppData"),
                roots: LibraryRoots::for_library_root(&tmp.0.join("Spiral")),
                lyrics_sidecar_enabled: false,
            };

            // The scan re-points the row instead of adding a second one.
            source_scan::reconcile_source(&db, &ctx, source, ReconcileScope::All).unwrap();
            let tracks = db::get_tracks_for_source(&lock(), source).unwrap();
            assert_eq!(tracks.len(), 1);
            let track = &tracks[0];
            assert_eq!(track.id, id);
            assert_eq!(Path::new(&track.file_path), file);
            assert!(track.missing_since.is_none());
            assert_eq!(track.rating, 80);

            // The rows the old scan left behind: the old spelling, marked
            // missing, and a new row for the spelling on disk.
            let duplicate = |missing: bool| {
                let id = insert_track(&lock(), "ALBUM/a.wav", source);
                if missing {
                    lock()
                        .execute(
                            "UPDATE tracks SET missing_since = 'then' WHERE id = ?1",
                            [&id],
                        )
                        .unwrap();
                }
                id
            };
            // Deleting the missing row from disk deletes nothing...
            let stale = duplicate(true);
            let stale = remove_row(&lock(), &stale);
            assert_eq!(
                delete_removed_track_file(&lock(), &stale, false).unwrap(),
                RemovedFile::KeptMissing
            );
            assert!(file.is_file());
            // ...nor does it when the row wasn't marked missing, since the
            // other row still names the file.
            let stale = duplicate(false);
            let stale = remove_row(&lock(), &stale);
            assert_eq!(
                delete_removed_track_file(&lock(), &stale, false).unwrap(),
                RemovedFile::KeptShared
            );
            assert!(file.is_file());

            // Duplicates already in a library merge at the next startup scan,
            // into the row with the history.
            let stale = duplicate(true);
            db::set_track_rating(&lock(), &stale, 0).unwrap();
            source_scan::reconcile_all(&db, &ctx);
            let tracks = db::get_tracks_for_source(&lock(), source).unwrap();
            assert_eq!(tracks.len(), 1);
            assert_eq!((&tracks[0].id, tracks[0].rating), (&id, 80));
            assert_eq!(Path::new(&tracks[0].file_path), file);
        }

        #[test]
        fn superseded_files_are_removed() {
            let tmp = TempDir::new("superseded");
            let conn = conn();
            let root = tmp.dir("Source");
            let nested = tmp.dir("Source/Artist/Album");
            let (old, sidecar) = audio_with_sidecar(&nested, "old");
            remove_superseded_file(&conn, &TrackId::new(), Some(&root), &old, true);
            assert!(!old.exists() && !sidecar.exists());
            // Emptied folders are pruned up to the source root.
            assert!(!tmp.0.join("Source/Artist").exists());
            assert!(root.is_dir());
        }
    }
}
