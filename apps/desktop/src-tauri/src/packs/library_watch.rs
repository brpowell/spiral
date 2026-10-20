//! Debounced file watcher for the Spiral Library's `Packs` folder.
//! Emits `packs://library-changed` so the UI can live-reload hand-edited items.

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

pub const LIBRARY_PACKS_CHANGED_EVENT: &str = "packs://library-changed";

const DEBOUNCE: Duration = Duration::from_millis(350);

static WATCH_STARTED: AtomicBool = AtomicBool::new(false);
static WATCHED_ROOT: OnceLock<Mutex<Option<PathBuf>>> = OnceLock::new();
static WATCHER: OnceLock<Mutex<Option<RecommendedWatcher>>> = OnceLock::new();

/// Start watching `<library root>/Packs/` once for the process lifetime. The folder follows
/// the library when it is relocated; see `retarget_library_packs_watch`.
pub fn start_library_packs_watch(app: AppHandle) {
    if WATCH_STARTED.swap(true, Ordering::SeqCst) {
        return;
    }

    let root = match super::paths::ensure_library_packs_root(&app) {
        Ok(dir) => dir,
        Err(err) => {
            eprintln!("library packs watch: could not ensure library packs root: {err}");
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
            eprintln!("library packs watch: failed to create watcher: {err}");
            return;
        }
    };

    if let Err(err) = watcher.watch(&root, RecursiveMode::Recursive) {
        eprintln!(
            "library packs watch: failed to watch {}: {err}",
            root.display()
        );
        return;
    }

    *WATCHED_ROOT
        .get_or_init(|| Mutex::new(None))
        .lock()
        .expect("library watched root lock") = Some(root);
    WATCHER
        .get_or_init(|| Mutex::new(None))
        .lock()
        .expect("library watcher lock")
        .replace(watcher);

    let app = Arc::new(app);
    thread::Builder::new()
        .name("library-packs-watch".into())
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
                        if let Err(err) = app.emit(LIBRARY_PACKS_CHANGED_EVENT, ()) {
                            eprintln!("library packs watch: emit failed: {err}");
                        }
                    }
                    Err(err) => eprintln!("library packs watch: {err}"),
                }
            }
        })
        .ok();
}

/// Point the running watcher at the current library's `Packs` folder (after a relocate or
/// switch). No-op when the watcher never started or the folder did not change.
pub fn retarget_library_packs_watch(app: &AppHandle) {
    let Ok(new_root) = super::paths::ensure_library_packs_root(app) else {
        return;
    };
    let (Some(watcher_slot), Some(root_slot)) = (WATCHER.get(), WATCHED_ROOT.get()) else {
        return;
    };
    let mut watcher_guard = watcher_slot.lock().expect("library watcher lock");
    let mut root_guard = root_slot.lock().expect("library watched root lock");
    let Some(watcher) = watcher_guard.as_mut() else {
        return;
    };
    if root_guard.as_ref() == Some(&new_root) {
        return;
    }
    if let Some(old) = root_guard.take() {
        let _ = watcher.unwatch(&old);
    }
    match watcher.watch(&new_root, RecursiveMode::Recursive) {
        Ok(()) => *root_guard = Some(new_root),
        Err(err) => eprintln!(
            "library packs watch: failed to watch {}: {err}",
            new_root.display()
        ),
    }
}

fn is_relevant_event(event: &notify::Event) -> bool {
    use notify::EventKind;
    match event.kind {
        EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_) => {
            !event.paths.is_empty() && event.paths.iter().any(is_library_content_path)
        }
        _ => false,
    }
}

fn is_library_content_path(path: &PathBuf) -> bool {
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
