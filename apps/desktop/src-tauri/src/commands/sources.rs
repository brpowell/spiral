use crate::commands::library::DbState;
use crate::fs_probe::{self, Probed};
use crate::path_scope;
use crate::settings;
use crate::source_scan::{self, ReconcileScope, ReconcileSummary, ScanContext, ScanProgress};
use crate::source_watch;
use crate::sources::{self, LibraryRoots, Source};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};

/// Emitted after a source's tracks changed on disk or the source itself was
/// added, moved or removed, so the library view reloads. The payload is the
/// [`ReconcileSummary`] for reconcile passes and `{ sourceId }` otherwise.
pub const LIBRARY_TRACKS_CHANGED_EVENT: &str = "library://tracks-changed";

/// Emitted as a source's scan (the first one after adding it, or a rescan)
/// starts, reports progress and ends, so the UI can show it in progress.
pub const SOURCE_SCAN_EVENT: &str = "library://source-scan";

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SourceScanEvent {
    source_id: i64,
    /// `started`, `progress`, or `finished` (with `summary` unless the scan
    /// errored).
    phase: &'static str,
    summary: Option<ReconcileSummary>,
    progress: Option<ScanProgress>,
    /// True for the startup pass, which nobody asked for.
    background: bool,
}

/// Least time between progress events while reading files.
const PROGRESS_EVERY: Duration = Duration::from_millis(100);

/// A scan that's running now, for a window that opened after it started
/// (the startup scan begins before the UI is listening).
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveScan {
    source_id: i64,
    background: bool,
    progress: Option<ScanProgress>,
}

static ACTIVE_SCANS: Mutex<Vec<ActiveScan>> = Mutex::new(Vec::new());

fn track_active_scan(event: &SourceScanEvent) {
    let mut active = ACTIVE_SCANS.lock().unwrap_or_else(|e| e.into_inner());
    match event.phase {
        "started" => {
            active.retain(|a| a.source_id != event.source_id);
            active.push(ActiveScan {
                source_id: event.source_id,
                background: event.background,
                progress: None,
            });
        }
        "progress" => {
            if let Some(a) = active.iter_mut().find(|a| a.source_id == event.source_id) {
                a.progress = event.progress.clone();
            }
        }
        _ => active.retain(|a| a.source_id != event.source_id),
    }
}

/// The scans running now, with how far each has got.
#[tauri::command]
pub fn get_active_scans() -> Vec<ActiveScan> {
    ACTIVE_SCANS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
}

fn emit_source_scan(app: &AppHandle, event: SourceScanEvent) {
    track_active_scan(&event);
    if let Err(err) = app.emit(SOURCE_SCAN_EVENT, event) {
        eprintln!("emit {SOURCE_SCAN_EVENT}: {err}");
    }
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SourceChanged {
    source_id: i64,
}

fn scan_context(app: &AppHandle) -> Result<ScanContext, String> {
    Ok(ScanContext {
        app_data_dir: settings::app_data_dir(app)?,
        roots: LibraryRoots::from_settings(&settings::resolved_library_settings(app)),
        lyrics_sidecar_enabled: settings::lyrics_sidecar_sync_enabled(app),
    })
}

fn emit_if_changed(app: &AppHandle, summary: &ReconcileSummary) {
    if summary.changed() {
        if let Err(err) = app.emit(LIBRARY_TRACKS_CHANGED_EVENT, summary) {
            eprintln!("emit {LIBRARY_TRACKS_CHANGED_EVENT}: {err}");
        }
    }
}

/// Tell the frontend a source changed, so it reloads the library (and drops
/// what it guessed about the source, such as that its folder was offline).
pub(crate) fn emit_source_changed(app: &AppHandle, source_id: i64) {
    if let Err(err) = app.emit(LIBRARY_TRACKS_CHANGED_EVENT, SourceChanged { source_id }) {
        eprintln!("emit {LIBRARY_TRACKS_CHANGED_EVENT}: {err}");
    }
}

/// Reconcile a source (or the given paths in it) and tell the frontend if
/// anything changed. Blocking; the file watcher calls this from its own thread.
pub fn reconcile_and_notify(
    app: &AppHandle,
    source_id: i64,
    scope: ReconcileScope<'_>,
) -> Result<ReconcileSummary, String> {
    let ctx = scan_context(app)?;
    let state = app.state::<DbState>();
    let summary = source_scan::reconcile_source(&state.0, &ctx, source_id, scope)?;
    emit_if_changed(app, &summary);
    Ok(summary)
}

/// Reconcile a whole source, announcing its start, progress and end to the UI.
/// `background` marks a scan the user didn't ask for (the startup pass), which
/// the UI shows on the folder's card but doesn't announce with a toast unless
/// it runs long. Blocking.
fn scan_source_with_events(
    app: &AppHandle,
    source_id: i64,
    background: bool,
) -> Result<ReconcileSummary, String> {
    emit_source_scan(
        app,
        SourceScanEvent {
            source_id,
            phase: "started",
            summary: None,
            progress: None,
            background,
        },
    );
    let result = (|| {
        let ctx = scan_context(app)?;
        let state = app.state::<DbState>();
        // Called from several reader threads at once.
        let last = Mutex::new((Instant::now() - PROGRESS_EVERY, 0usize));
        let report = |progress: ScanProgress| {
            if let ScanProgress::Reading { current, total } = progress {
                let mut last = last.lock().unwrap_or_else(|e| e.into_inner());
                // Threads finish in any order: never report a count that goes
                // backwards. The last file always goes through, so the bar
                // reaches the end.
                if current <= last.1 || (last.0.elapsed() < PROGRESS_EVERY && current < total) {
                    return;
                }
                *last = (Instant::now(), current);
            }
            emit_source_scan(
                app,
                SourceScanEvent {
                    source_id,
                    phase: "progress",
                    summary: None,
                    progress: Some(progress),
                    background,
                },
            );
        };
        let summary = source_scan::reconcile_source_with_progress(
            &state.0,
            &ctx,
            source_id,
            ReconcileScope::All,
            Some(&report),
        )?;
        emit_if_changed(app, &summary);
        Ok(summary)
    })();
    emit_source_scan(
        app,
        SourceScanEvent {
            source_id,
            phase: "finished",
            summary: result.as_ref().ok().cloned(),
            progress: None,
            background,
        },
    );
    result
}

async fn reconcile_in_background(
    app: AppHandle,
    source_id: i64,
) -> Result<ReconcileSummary, String> {
    tauri::async_runtime::spawn_blocking(move || scan_source_with_events(&app, source_id, false))
        .await
        .map_err(|e| e.to_string())
        .and_then(|r| r)
}

/// Let the webview reach a source's folder. Resolving the path of a network
/// share that isn't answering stalls, and startup mustn't wait on it: that
/// folder is allowed from its own thread once the share responds.
fn allow_source_dir(app: &AppHandle, root: &Path) {
    if fs_probe::probe_dir(root) != Probed::Stalled {
        path_scope::allow_dir(app, root);
        return;
    }
    let app = app.clone();
    let root = root.to_path_buf();
    let _ = std::thread::Builder::new()
        .name("allow-source-dir".into())
        .spawn(move || path_scope::allow_dir(&app, &root));
}

/// Startup, and after the library is switched or moved: let the webview reach
/// every source folder (for playback and artwork), reconcile all sources in
/// the background to catch what changed while Spiral wasn't looking, and
/// watch their folders from now on.
pub fn init(app: &AppHandle) {
    let watched = {
        let state = app.state::<DbState>();
        let conn = state.0.lock().unwrap_or_else(|e| e.into_inner());
        apply_legacy_auto_organize(app, &conn);
        sources::list_sources(&conn).unwrap_or_default()
    };
    for source in &watched {
        if let Some(root) = &source.root_path {
            allow_source_dir(app, Path::new(root));
        }
    }

    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        // Starting the watchers looks at each folder, which can stall on a
        // network share that isn't connected: not on the startup thread.
        source_watch::sync(&app);
        let state = app.state::<DbState>();
        source_scan::merge_duplicate_rows(&state.0);
        let ids = match sources::list_sources(&state.0.lock().unwrap_or_else(|e| e.into_inner())) {
            Ok(list) => list.into_iter().map(|s| s.id).collect::<Vec<_>>(),
            Err(err) => {
                eprintln!("reconcile sources: {err}");
                return;
            }
        };
        // Each source's scan shows its progress, so one the last run didn't
        // finish picks up where it left off: files already read are skipped.
        for id in ids {
            if let Err(err) = scan_source_with_events(&app, id, true) {
                eprintln!("reconcile source {id}: {err}");
            }
        }
    });
}

/// Organizing used to be one global setting. Carry an "off" over to the
/// Spiral folder's `Tracks` source once, then drop the setting.
fn apply_legacy_auto_organize(app: &AppHandle, conn: &rusqlite::Connection) {
    match settings::take_legacy_auto_organize(app) {
        Ok(Some(false)) => {
            let roots = LibraryRoots::from_settings(&settings::resolved_library_settings(app));
            let result = match sources::managed_source_id(conn, &roots) {
                Ok(Some(id)) => sources::set_source_organize(conn, id, false).map(|_| ()),
                Ok(None) => Ok(()),
                Err(err) => Err(err.to_string()),
            };
            if let Err(err) = result {
                eprintln!("carry over auto-organize setting: {err}");
            }
        }
        Ok(_) => {}
        Err(err) => eprintln!("carry over auto-organize setting: {err}"),
    }
}

/// Whether a watched source is being watched live right now.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceStatus {
    source_id: i64,
    status: source_watch::WatchStatus,
}

/// Watch status for every source with a folder, so the UI can flag offline ones.
/// Looks at each folder, which can stall on a dropped network share, so it
/// runs off the main thread (and gives up on a folder after a few seconds).
#[tauri::command(async)]
pub fn get_source_statuses(state: State<DbState>) -> Result<Vec<SourceStatus>, String> {
    let ids: Vec<i64> = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        sources::list_sources(&conn)
            .map_err(|e| e.to_string())?
            .into_iter()
            .map(|s| s.id)
            .collect()
    };
    Ok(source_watch::statuses(&ids)
        .into_iter()
        .map(|(source_id, status)| SourceStatus { source_id, status })
        .collect())
}

/// The ids of the sources whose folder isn't answering right now (an unplugged
/// drive, a dropped share). Playback asks before it walks the set list, so a
/// dead folder is settled once instead of file by file. Each folder is looked
/// at for a few seconds at most, together, and off the main thread.
#[tauri::command(async)]
pub fn get_unavailable_source_ids(state: State<DbState>) -> Result<Vec<i64>, String> {
    let roots: Vec<(i64, PathBuf)> = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        sources::list_sources(&conn)
            .map_err(|e| e.to_string())?
            .into_iter()
            .filter_map(|s| Some((s.id, PathBuf::from(s.root_path?))))
            .collect()
    };
    Ok(unavailable_ids(&roots))
}

fn unavailable_ids(roots: &[(i64, PathBuf)]) -> Vec<i64> {
    let paths: Vec<PathBuf> = roots.iter().map(|(_, root)| root.clone()).collect();
    roots
        .iter()
        .zip(fs_probe::probe_dirs(&paths))
        .filter(|(_, probed)| !probed.is_yes())
        .map(|((id, _), _)| *id)
        .collect()
}

#[tauri::command]
pub fn list_sources(state: State<DbState>) -> Result<Vec<Source>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    sources::list_sources(&conn).map_err(|e| e.to_string())
}

/// Add a folder the user picked as a source. It isn't scanned yet: the Add
/// dialog can still be cancelled, which removes it again. Once they confirm,
/// `rescan_source` indexes it, and `library://tracks-changed` fires as its
/// tracks land.
///
/// Checking the path can be slow over a network source; keep it off the main thread.
#[tauri::command]
pub async fn add_source(
    app: AppHandle,
    root_path: String,
    name: Option<String>,
) -> Result<Source, String> {
    let task_app = app.clone();
    let source = tauri::async_runtime::spawn_blocking(move || {
        let root_path = path_scope::ensure_allowed(&task_app, &root_path)?
            .to_string_lossy()
            .into_owned();
        let roots = LibraryRoots::from_settings(&settings::resolved_library_settings(&task_app));
        let state = task_app.state::<DbState>();
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        sources::add_source(&conn, &roots, &root_path, name.as_deref())
    })
    .await
    .map_err(|e| e.to_string())??;
    if let Some(root) = &source.root_path {
        path_scope::allow_dir(&app, Path::new(root));
    }
    emit_source_changed(&app, source.id);
    source_watch::sync(&app);
    Ok(source)
}

/// Remove a source: its tracks leave the library, its files stay. Restarting
/// the watchers looks at folders, so this runs off the main thread.
#[tauri::command(async)]
pub fn remove_source(
    app: AppHandle,
    state: State<DbState>,
    source_id: i64,
) -> Result<usize, String> {
    let ctx = scan_context(&app)?;
    let removed = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        source_scan::remove_source(&conn, &ctx, source_id)?
    };
    source_watch::sync(&app);
    emit_source_changed(&app, source_id);
    Ok(removed)
}

/// Look at a source's files again now.
#[tauri::command]
pub async fn rescan_source(app: AppHandle, source_id: i64) -> Result<ReconcileSummary, String> {
    reconcile_in_background(app, source_id).await
}

/// Turn organizing on or off for a source, refused with
/// [`sources::SOURCE_UNAVAILABLE`] when turning it on for a folder that's
/// offline. Existing files don't move here. Checking the folder can stall on
/// a network share, so this runs off the main thread.
#[tauri::command(async)]
pub fn set_source_organize(
    state: State<DbState>,
    source_id: i64,
    auto_organize: bool,
) -> Result<Source, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    sources::change_source_organize(&conn, source_id, auto_organize)
}

/// Set a source's own path format; `None` inherits the global one.
#[tauri::command]
pub fn set_source_path_format(
    state: State<DbState>,
    source_id: i64,
    path_format: Option<String>,
) -> Result<Source, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    sources::set_source_path_format(&conn, source_id, path_format)
}

/// Choose the source new imports are copied into.
#[tauri::command]
pub fn set_import_source(state: State<DbState>, source_id: i64) -> Result<Source, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    sources::set_import_source(&conn, source_id)
}

/// The source new imports are copied into, if any, and whether copying into
/// it is possible right now. Checking the folder can stall on a network share,
/// so this runs off the main thread.
#[tauri::command(async)]
pub fn get_import_source(state: State<DbState>) -> Result<sources::ImportTarget, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    sources::import_target(&conn).map_err(|e| e.to_string())
}

/// Let Spiral manage the user's music (onboarding): create `Tracks` in the
/// Spiral folder, add it as an organized source and make it the import
/// target if none is set. Calling it again returns the existing source.
#[tauri::command(async)]
pub fn create_managed_source(app: AppHandle, state: State<DbState>) -> Result<Source, String> {
    let roots = LibraryRoots::from_settings(&settings::resolved_library_settings(&app));
    let (source, existed) = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        let existed = sources::managed_source_id(&conn, &roots)
            .map_err(|e| e.to_string())?
            .is_some();
        (sources::create_managed_source(&conn, &roots)?, existed)
    };
    if existed {
        return Ok(source);
    }
    if let Some(root) = &source.root_path {
        path_scope::allow_dir(&app, Path::new(root));
    }
    emit_source_changed(&app, source.id);
    source_watch::sync(&app);
    // `Tracks` may already hold files (e.g. from an earlier library).
    let id = source.id;
    tauri::async_runtime::spawn(async move {
        if let Err(err) = reconcile_in_background(app, id).await {
            eprintln!("initial scan of source {id}: {err}");
        }
    });
    Ok(source)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unavailable_ids_lists_missing_and_stalled_folders_only() {
        let base = std::env::temp_dir().join(format!("spiral-unavailable-{}", std::process::id()));
        let here = base.join("here");
        let stalled = base.join("stalled");
        std::fs::create_dir_all(&here).unwrap();
        std::fs::create_dir_all(&stalled).unwrap();
        let _stall = fs_probe::stall_dir(&stalled);

        let roots = [(1, here.clone()), (2, base.join("unplugged")), (3, stalled)];
        assert_eq!(unavailable_ids(&roots), vec![2, 3]);
        assert_eq!(unavailable_ids(&[]), Vec::<i64>::new());
        let _ = std::fs::remove_dir_all(&base);
    }
}
