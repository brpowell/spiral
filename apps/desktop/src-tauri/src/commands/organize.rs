use crate::commands::library::DbState;
use crate::commands::sources::LIBRARY_TRACKS_CHANGED_EVENT;
use crate::file_plan::{self, ApplyContext, ApplySummary, FilePlan, Finish, PlanSummary, Progress};
use crate::settings;
use std::path::Path;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

/// Emitted while files move: `{ sourceId, done, total }`. `sourceId` is null
/// while an interrupted plan is finished at startup.
pub const FILE_PLAN_PROGRESS_EVENT: &str = "library://file-plan-progress";

/// How often progress is emitted at most, besides the first and last step.
const PROGRESS_EVERY: Duration = Duration::from_millis(100);

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ProgressPayload {
    source_id: Option<i64>,
    done: usize,
    total: usize,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SourceChanged {
    source_id: Option<i64>,
}

fn apply_context(app: &AppHandle) -> ApplyContext {
    let library = settings::resolved_library_settings(app);
    ApplyContext {
        journal: file_plan::journal_path(Path::new(&library.library_root)),
        app_data_dir: settings::app_data_dir(app).ok(),
    }
}

fn emit_progress(app: &AppHandle, source_id: Option<i64>) -> impl FnMut(Progress) + '_ {
    let mut last: Option<Instant> = None;
    move |p: Progress| {
        let due = last.is_none_or(|t| t.elapsed() >= PROGRESS_EVERY) || p.done == p.total;
        if !due {
            return;
        }
        last = Some(Instant::now());
        let payload = ProgressPayload {
            source_id,
            done: p.done,
            total: p.total,
        };
        if let Err(err) = app.emit(FILE_PLAN_PROGRESS_EVENT, payload) {
            eprintln!("emit {FILE_PLAN_PROGRESS_EVENT}: {err}");
        }
    }
}

fn emit_tracks_changed(app: &AppHandle, source_id: Option<i64>) {
    if let Err(err) = app.emit(LIBRARY_TRACKS_CHANGED_EVENT, SourceChanged { source_id }) {
        eprintln!("emit {LIBRARY_TRACKS_CHANGED_EVENT}: {err}");
    }
}

fn plan_organize(
    app: &AppHandle,
    source_id: i64,
    path_format: Option<String>,
) -> Result<FilePlan, String> {
    let default_format = settings::resolved_library_settings(app).organize_path_format;
    let state = app.state::<DbState>();
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    file_plan::plan_organize_source(&conn, source_id, path_format, &default_format)
}

/// What organizing a source would do, for the user to confirm: how many
/// files would move, a sample of the moves, and the conflicts. Moves nothing.
/// `path_format` previews a format other than the source's.
#[tauri::command]
pub async fn preview_organize_source(
    app: AppHandle,
    source_id: i64,
    path_format: Option<String>,
) -> Result<PlanSummary, String> {
    tauri::async_runtime::spawn_blocking(move || {
        plan_organize(&app, source_id, path_format).map(|plan| plan.summary())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Move a source's files to where its path format puts them, then turn
/// organizing on for it (with `path_format` as its format, when given).
/// Emits `library://file-plan-progress` while moving and
/// `library://tracks-changed` when done.
#[tauri::command]
pub async fn apply_organize_source(
    app: AppHandle,
    source_id: i64,
    path_format: Option<String>,
) -> Result<ApplySummary, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut plan = plan_organize(&app, source_id, path_format.clone())?;
        plan.finish = Some(Finish::OrganizeSource {
            source_id,
            path_format,
        });
        let ctx = apply_context(&app);
        let state = app.state::<DbState>();
        let result = file_plan::apply(&state.0, &ctx, &plan, emit_progress(&app, Some(source_id)));
        emit_tracks_changed(&app, Some(source_id));
        result
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Startup, and after the library is switched or moved: finish file moves a
/// crash interrupted, then start sources (reconcile and watch). With nothing
/// to finish, sources start right away; otherwise both run in the background,
/// so reconciling never sees a half-applied plan.
pub fn init(app: &AppHandle) {
    let ctx = apply_context(app);
    if !ctx.journal.exists() {
        super::sources::init(app);
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<DbState>();
        match file_plan::recover(&state.0, &ctx, emit_progress(&app, None)) {
            Ok(Some(summary)) => {
                if summary.failed > 0 {
                    eprintln!("finished interrupted file moves: {summary:?}");
                }
                emit_tracks_changed(&app, None);
            }
            Ok(None) => {}
            Err(err) => eprintln!("finish interrupted file moves: {err}"),
        }
        super::sources::init(&app);
    });
}
