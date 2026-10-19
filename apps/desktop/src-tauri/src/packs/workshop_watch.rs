//! Debounced file watcher for the workshop root.
//! Emits `workshop://changed` so the UI can live-reload hand-edited drafts.

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

pub const WORKSHOP_CHANGED_EVENT: &str = "workshop://changed";

const DEBOUNCE: Duration = Duration::from_millis(350);

static WATCH_STARTED: AtomicBool = AtomicBool::new(false);
static WATCHER: OnceLock<Mutex<Option<RecommendedWatcher>>> = OnceLock::new();

/// Start watching `{app_data}/packs/workshop/` once for the process lifetime.
pub fn start_workshop_watch(app: AppHandle) {
    if WATCH_STARTED.swap(true, Ordering::SeqCst) {
        return;
    }

    let workshop = match super::paths::ensure_workshop_root(&app) {
        Ok(dir) => dir,
        Err(err) => {
            eprintln!("workshop watch: could not ensure workshop root: {err}");
            return;
        }
    };

    let (tx, rx) = mpsc::channel();
    let mut watcher = match RecommendedWatcher::new(
        move |res: Result<notify::Event, notify::Error>| {
            let _ = tx.send(res);
        },
        notify::Config::default(),
    ) {
        Ok(w) => w,
        Err(err) => {
            eprintln!("workshop watch: failed to create watcher: {err}");
            return;
        }
    };

    if let Err(err) = watcher.watch(&workshop, RecursiveMode::Recursive) {
        eprintln!(
            "workshop watch: failed to watch {}: {err}",
            workshop.display()
        );
        return;
    }

    WATCHER
        .get_or_init(|| Mutex::new(None))
        .lock()
        .expect("workshop watcher lock")
        .replace(watcher);

    let app = Arc::new(app);
    thread::Builder::new()
        .name("workshop-watch".into())
        .spawn(move || {
            let mut last_emit = Instant::now() - DEBOUNCE;
            while let Ok(res) = rx.recv() {
                match res {
                    Ok(event) => {
                        if !is_relevant_event(&event) {
                            continue;
                        }
                        // Drain burst then debounce.
                        while let Ok(Ok(more)) = rx.try_recv() {
                            let _ = more;
                        }
                        let elapsed = last_emit.elapsed();
                        if elapsed < DEBOUNCE {
                            thread::sleep(DEBOUNCE - elapsed);
                            while let Ok(Ok(more)) = rx.try_recv() {
                                let _ = more;
                            }
                        }
                        last_emit = Instant::now();
                        if let Err(err) = app.emit(WORKSHOP_CHANGED_EVENT, ()) {
                            eprintln!("workshop watch: emit failed: {err}");
                        }
                    }
                    Err(err) => eprintln!("workshop watch: {err}"),
                }
            }
        })
        .ok();
}

fn is_relevant_event(event: &notify::Event) -> bool {
    use notify::EventKind;
    match event.kind {
        EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_) => {
            !event.paths.is_empty() && event.paths.iter().any(is_workshop_content_path)
        }
        _ => false,
    }
}

fn is_workshop_content_path(path: &PathBuf) -> bool {
    let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
        return false;
    };
    // Ignore editor swap/temp noise.
    if name.starts_with('.') || name.ends_with('~') || name.ends_with(".tmp") {
        return false;
    }
    name.ends_with(".json")
        || path
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|ext| matches!(ext, "png" | "jpg" | "jpeg" | "webp" | "css"))
}
