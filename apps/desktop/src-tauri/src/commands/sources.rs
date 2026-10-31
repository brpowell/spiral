use crate::commands::library::DbState;
use crate::path_scope;
use crate::settings;
use crate::source_scan::{self, ReconcileScope, ReconcileSummary, ScanContext};
use crate::source_watch;
use crate::sources::{self, LibraryRoots, Source};
use std::path::Path;
use tauri::{AppHandle, Emitter, Manager, State};

/// Emitted after a source's tracks changed on disk or the source itself was
/// added, moved or removed, so the library view reloads. The payload is the
/// [`ReconcileSummary`] for reconcile passes and `{ sourceId }` otherwise.
pub const LIBRARY_TRACKS_CHANGED_EVENT: &str = "library://tracks-changed";

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

fn emit_source_changed(app: &AppHandle, source_id: i64) {
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

async fn reconcile_in_background(
    app: AppHandle,
    source_id: i64,
) -> Result<ReconcileSummary, String> {
    tauri::async_runtime::spawn_blocking(move || {
        reconcile_and_notify(&app, source_id, ReconcileScope::All)
    })
    .await
    .map_err(|e| e.to_string())?
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
            path_scope::allow_dir(app, Path::new(root));
        }
    }

    source_watch::sync(app);

    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let ctx = match scan_context(&app) {
            Ok(ctx) => ctx,
            Err(err) => {
                eprintln!("startup reconcile: {err}");
                return;
            }
        };
        let state = app.state::<DbState>();
        for summary in source_scan::reconcile_all(&state.0, &ctx) {
            emit_if_changed(&app, &summary);
        }
    });
}

/// Organizing used to be one global setting. Carry an "off" over to the
/// default source once, then drop the setting.
fn apply_legacy_auto_organize(app: &AppHandle, conn: &rusqlite::Connection) {
    match settings::take_legacy_auto_organize(app) {
        Ok(Some(false)) => {
            if let Err(err) = sources::set_source_organize(conn, sources::DEFAULT_SOURCE_ID, false)
            {
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
#[tauri::command]
pub fn get_source_statuses(state: State<DbState>) -> Result<Vec<SourceStatus>, String> {
    let ids: Vec<i64> = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        sources::list_sources(&conn)
            .map_err(|e| e.to_string())?
            .into_iter()
            .filter(|s| s.id != sources::OTHER_SOURCE_ID)
            .map(|s| s.id)
            .collect()
    };
    Ok(source_watch::statuses(&ids)
        .into_iter()
        .map(|(source_id, status)| SourceStatus { source_id, status })
        .collect())
}

#[tauri::command]
pub fn list_sources(state: State<DbState>) -> Result<Vec<Source>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    sources::list_sources(&conn).map_err(|e| e.to_string())
}

/// Add a folder the user picked as a source. It is indexed in the
/// background; `library://tracks-changed` fires as its tracks land.
#[tauri::command]
pub fn add_source(
    app: AppHandle,
    state: State<DbState>,
    root_path: String,
    name: Option<String>,
) -> Result<Source, String> {
    path_scope::ensure_allowed(&app, &root_path)?;
    let roots = LibraryRoots::from_settings(&settings::resolved_library_settings(&app));
    let source = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        sources::add_source(&conn, &roots, &root_path, name.as_deref())?
    };
    if let Some(root) = &source.root_path {
        path_scope::allow_dir(&app, Path::new(root));
    }
    emit_source_changed(&app, source.id);
    source_watch::sync(&app);

    let id = source.id;
    tauri::async_runtime::spawn(async move {
        if let Err(err) = reconcile_in_background(app, id).await {
            eprintln!("initial scan of source {id}: {err}");
        }
    });
    Ok(source)
}

/// Remove a source: its tracks leave the library, its files stay.
#[tauri::command]
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

/// Look at a source's files again now. For Other, which has no folder, this
/// only updates which tracks are missing.
#[tauri::command]
pub async fn rescan_source(app: AppHandle, source_id: i64) -> Result<ReconcileSummary, String> {
    reconcile_in_background(app, source_id).await
}

/// Point a source at the folder its files moved to, then rescan it.
#[tauri::command]
pub async fn relocate_source(
    app: AppHandle,
    source_id: i64,
    new_root_path: String,
) -> Result<Source, String> {
    path_scope::ensure_allowed(&app, &new_root_path)?;
    let ctx = scan_context(&app)?;
    let task_app = app.clone();
    let source = tauri::async_runtime::spawn_blocking(move || {
        let state = task_app.state::<DbState>();
        source_scan::relocate_source(&state.0, &ctx, source_id, &new_root_path)
    })
    .await
    .map_err(|e| e.to_string())??;
    if let Some(root) = &source.root_path {
        path_scope::allow_dir(&app, Path::new(root));
    }
    source_watch::sync(&app);
    emit_source_changed(&app, source_id);
    reconcile_in_background(app, source_id).await?;
    Ok(source)
}

/// Turn organizing on or off for a source. Existing files don't move here.
#[tauri::command]
pub fn set_source_organize(
    state: State<DbState>,
    source_id: i64,
    auto_organize: bool,
) -> Result<Source, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    sources::set_source_organize(&conn, source_id, auto_organize)
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

/// The source new imports are copied into (the default when none is set).
#[tauri::command]
pub fn get_import_source(state: State<DbState>) -> Result<Source, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let id = sources::import_source_id(&conn).map_err(|e| e.to_string())?;
    sources::get_source(&conn, id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Source {id} not found"))
}
