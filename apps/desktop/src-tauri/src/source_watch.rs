//! File watchers for watched library sources: one recursive watcher per
//! watched folder, so files added, changed, renamed or deleted there show up
//! without a rescan.
//!
//! Events are coalesced per source until the folder has been quiet for
//! [`QUIET`], then that source's changed paths are reconciled off the event
//! thread. A large burst, or a platform rescan notice, reconciles the whole
//! source instead. A folder that can't be watched (an unplugged drive, or no
//! watcher at all) is retried every [`RETRY`]; until then it only updates at
//! startup and on a manual rescan.

use crate::commands::library::DbState;
use crate::commands::sources::reconcile_and_notify;
use crate::settings;
use crate::source_scan::ReconcileScope;
use crate::sources::{self, LibraryRoots, SourceKind};
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::{BTreeSet, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

/// How long a source must be quiet before its changes are reconciled.
const QUIET: Duration = Duration::from_millis(1500);
/// A steady stream of events still reconciles at least this often.
const MAX_WAIT: Duration = Duration::from_secs(10);
/// More changed paths than this in one batch reconciles the whole source.
const MAX_PATHS: usize = 500;
/// How often to retry a folder that couldn't be watched, and to check that
/// watched folders are still there.
const RETRY: Duration = Duration::from_secs(60);
/// How often the worker wakes to flush quiet sources.
const TICK: Duration = Duration::from_millis(250);

struct Message {
    source_id: i64,
    generation: u64,
    result: notify::Result<notify::Event>,
}

/// A watched folder's root as stored and as the OS reports it (watchers
/// report resolved paths, e.g. `/private/var` for `/var` on macOS).
#[derive(Debug, Clone)]
struct WatchRoot {
    root: PathBuf,
    resolved: PathBuf,
}

impl WatchRoot {
    fn new(root: PathBuf) -> Self {
        let resolved = root.canonicalize().unwrap_or_else(|_| root.clone());
        Self { root, resolved }
    }

    /// `path` in the stored root's form, or `None` when it is outside the
    /// root or inside the Spiral library (which a watched folder may contain).
    fn accept(&self, path: &Path, roots: &LibraryRoots) -> Option<PathBuf> {
        let path = match path.strip_prefix(&self.resolved) {
            Ok(rest) if self.resolved != self.root => self.root.join(rest),
            _ => path.to_path_buf(),
        };
        (path.starts_with(&self.root) && !sources::is_excluded_from_watched(&path, roots))
            .then_some(path)
    }
}

/// What to reconcile for a source once it has been quiet.
#[derive(Debug, PartialEq, Eq)]
enum Batch {
    All,
    Paths(Vec<PathBuf>),
}

/// Changes seen for one source since its last reconcile.
#[derive(Debug, Default)]
struct Pending {
    paths: BTreeSet<PathBuf>,
    full: bool,
    first: Option<Instant>,
    last: Option<Instant>,
}

impl Pending {
    fn record(&mut self, paths: impl IntoIterator<Item = PathBuf>, now: Instant) {
        if !self.full {
            self.paths.extend(paths);
            if self.paths.len() > MAX_PATHS {
                self.request_full(now);
                return;
            }
        }
        self.touch(now);
    }

    /// Reconcile the whole source: a rescan notice, an overflow or an error.
    fn request_full(&mut self, now: Instant) {
        self.full = true;
        self.paths.clear();
        self.touch(now);
    }

    fn touch(&mut self, now: Instant) {
        self.first.get_or_insert(now);
        self.last = Some(now);
    }

    fn is_empty(&self) -> bool {
        !self.full && self.paths.is_empty()
    }

    fn is_due(&self, now: Instant) -> bool {
        match (self.first, self.last) {
            (Some(first), Some(last)) => {
                now.duration_since(last) >= QUIET || now.duration_since(first) >= MAX_WAIT
            }
            _ => false,
        }
    }

    fn take(&mut self) -> Option<Batch> {
        let pending = std::mem::take(self);
        if pending.full {
            Some(Batch::All)
        } else if pending.paths.is_empty() {
            None
        } else {
            Some(Batch::Paths(pending.paths.into_iter().collect()))
        }
    }
}

/// What an event means for its source.
#[derive(Debug, PartialEq, Eq)]
enum Change {
    Ignore,
    Paths(Vec<PathBuf>),
    Rescan,
}

/// A rename reports both paths (or one event per side), so both are
/// reconciled: the old one is marked missing and the new one is added.
fn classify(event: &notify::Event) -> Change {
    use notify::EventKind;
    if event.need_rescan() {
        return Change::Rescan;
    }
    match event.kind {
        EventKind::Access(_) => Change::Ignore,
        _ if event.paths.is_empty() => Change::Ignore,
        _ => Change::Paths(event.paths.clone()),
    }
}

struct Watch {
    root: WatchRoot,
    generation: u64,
    /// `None` while the folder can't be watched; retried at `retry_at`.
    watcher: Option<RecommendedWatcher>,
    retry_at: Instant,
}

struct Registry {
    watches: HashMap<i64, Watch>,
    roots: LibraryRoots,
    tx: Sender<Message>,
    next_generation: u64,
}

static REGISTRY: OnceLock<Mutex<Registry>> = OnceLock::new();

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

fn library_roots(app: &AppHandle) -> LibraryRoots {
    LibraryRoots::from_settings(&settings::resolved_library_settings(app))
}

fn watch_folder(
    root: &WatchRoot,
    source_id: i64,
    generation: u64,
    tx: Sender<Message>,
) -> Result<RecommendedWatcher, String> {
    if !root.root.is_dir() {
        return Err("folder not found".into());
    }
    let mut watcher = RecommendedWatcher::new(
        move |result| {
            let _ = tx.send(Message {
                source_id,
                generation,
                result,
            });
        },
        notify::Config::default(),
    )
    .map_err(|e| e.to_string())?;
    watcher
        .watch(&root.root, RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;
    Ok(watcher)
}

impl Registry {
    fn attach(&mut self, source_id: i64, root: PathBuf) {
        self.next_generation += 1;
        let root = WatchRoot::new(root);
        let generation = self.next_generation;
        let watcher = match watch_folder(&root, source_id, generation, self.tx.clone()) {
            Ok(watcher) => Some(watcher),
            Err(err) => {
                eprintln!(
                    "source watch: can't watch {} (source {source_id}): {err}; retrying every {}s",
                    root.root.display(),
                    RETRY.as_secs()
                );
                None
            }
        };
        self.watches.insert(
            source_id,
            Watch {
                root,
                generation,
                watcher,
                retry_at: Instant::now() + RETRY,
            },
        );
    }

    /// The source's root when `generation` is still its current watcher.
    fn current_root(&self, source_id: i64, generation: u64) -> Option<&WatchRoot> {
        self.watches
            .get(&source_id)
            .filter(|w| w.generation == generation)
            .map(|w| &w.root)
    }
}

/// Make the running watchers match the open library's watched sources. Call
/// after a source is added, removed or relocated, or the library changes.
/// Starts the watcher thread on first use.
pub fn sync(app: &AppHandle) {
    let wanted: HashMap<i64, PathBuf> = {
        let state = app.state::<DbState>();
        let conn = lock(&state.0);
        match sources::list_sources(&conn) {
            Ok(list) => list
                .into_iter()
                .filter(|s| s.kind == SourceKind::Watched)
                .filter_map(|s| Some((s.id, PathBuf::from(s.root_path?))))
                .collect(),
            Err(err) => {
                eprintln!("source watch: list sources: {err}");
                return;
            }
        }
    };
    let roots = library_roots(app);

    let registry = REGISTRY.get_or_init(|| {
        let (tx, rx) = mpsc::channel();
        let app = app.clone();
        if let Err(err) = thread::Builder::new()
            .name("source-watch".into())
            .spawn(move || run(app, rx))
        {
            eprintln!("source watch: can't start thread: {err}");
        }
        Mutex::new(Registry {
            watches: HashMap::new(),
            roots: roots.clone(),
            tx,
            next_generation: 0,
        })
    });
    let mut registry = lock(registry);
    registry.roots = roots;
    registry
        .watches
        .retain(|id, w| wanted.get(id) == Some(&w.root.root));
    for (id, root) in wanted {
        if !registry.watches.contains_key(&id) {
            registry.attach(id, root);
        }
    }
}

fn reconcile_in_background(
    app: &AppHandle,
    busy: &Arc<Mutex<HashSet<i64>>>,
    id: i64,
    batch: Batch,
) {
    lock(busy).insert(id);
    let app = app.clone();
    let busy = Arc::clone(busy);
    tauri::async_runtime::spawn_blocking(move || {
        let result = match &batch {
            Batch::All => reconcile_and_notify(&app, id, ReconcileScope::All),
            Batch::Paths(paths) => reconcile_and_notify(&app, id, ReconcileScope::Paths(paths)),
        };
        if let Err(err) = result {
            eprintln!("source watch: reconcile source {id}: {err}");
        }
        lock(&busy).remove(&id);
    });
}

/// The watcher thread: collects events, and reconciles each source once it
/// has gone quiet and isn't already being reconciled.
fn run(app: AppHandle, rx: Receiver<Message>) {
    let mut pending: HashMap<(i64, u64), Pending> = HashMap::new();
    let busy = Arc::new(Mutex::new(HashSet::new()));
    let mut next_check = Instant::now() + RETRY;

    loop {
        let mut messages = Vec::new();
        match rx.recv_timeout(TICK) {
            Ok(message) => messages.push(message),
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return,
        }
        // Take everything already queued before deciding what's due.
        messages.extend(rx.try_iter());

        let now = Instant::now();
        let Some(registry) = REGISTRY.get() else {
            continue;
        };
        let mut registry = lock(registry);
        for message in messages {
            // Events from a watcher that was since removed or replaced are dropped.
            if let Some(root) = registry.current_root(message.source_id, message.generation) {
                record(&mut pending, message, root, &registry.roots);
            }
        }
        let busy_now = lock(&busy).clone();
        let mut due = Vec::new();
        pending.retain(|&(id, generation), changes| {
            if registry.current_root(id, generation).is_none() {
                return false; // Removed, relocated or library switched.
            }
            if busy_now.contains(&id) || !changes.is_due(now) {
                return true;
            }
            if let Some(batch) = changes.take() {
                due.push((id, batch));
            }
            false
        });

        // The folder itself went away (an unplugged drive): stop watching it
        // and reconcile everything, which marks its tracks missing.
        for (id, batch) in &mut due {
            if let Some(watch) = registry.watches.get_mut(id) {
                if watch.watcher.is_some() && !watch.root.root.is_dir() {
                    lost(watch, *id);
                    *batch = Batch::All;
                }
            }
        }

        let check_roots = now >= next_check;
        if check_roots {
            next_check = now + RETRY;
        }
        let tx = registry.tx.clone();
        for (&id, watch) in registry.watches.iter_mut() {
            if watch.watcher.is_some() {
                if check_roots && !watch.root.root.is_dir() {
                    lost(watch, id);
                    due.push((id, Batch::All));
                }
            } else if now >= watch.retry_at {
                watch.retry_at = now + RETRY;
                if let Ok(watcher) = watch_folder(&watch.root, id, watch.generation, tx.clone()) {
                    eprintln!(
                        "source watch: watching {} again (source {id})",
                        watch.root.root.display()
                    );
                    watch.watcher = Some(watcher);
                    due.push((id, Batch::All));
                }
            }
        }
        drop(registry);

        for (id, batch) in due {
            reconcile_in_background(&app, &busy, id, batch);
        }
    }
}

fn lost(watch: &mut Watch, id: i64) {
    eprintln!(
        "source watch: {} is gone (source {id}); retrying every {}s",
        watch.root.root.display(),
        RETRY.as_secs()
    );
    watch.watcher = None;
    watch.retry_at = Instant::now() + RETRY;
}

fn record(
    pending: &mut HashMap<(i64, u64), Pending>,
    message: Message,
    root: &WatchRoot,
    roots: &LibraryRoots,
) {
    let now = Instant::now();
    let key = (message.source_id, message.generation);
    let changes = pending.entry(key).or_default();
    match message.result {
        Ok(event) => match classify(&event) {
            Change::Ignore => {}
            Change::Paths(paths) => {
                let paths: Vec<_> = paths.iter().filter_map(|p| root.accept(p, roots)).collect();
                if !paths.is_empty() {
                    changes.record(paths, now);
                }
            }
            Change::Rescan => changes.request_full(now),
        },
        Err(err) => {
            eprintln!("source watch: source {}: {err}", message.source_id);
            changes.request_full(now);
        }
    }
    if changes.is_empty() {
        pending.remove(&key);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::event::{AccessKind, CreateKind, EventKind, ModifyKind, RemoveKind, RenameMode};
    use notify::Event;

    fn event(kind: EventKind, paths: &[&str]) -> Event {
        paths
            .iter()
            .fold(Event::new(kind), |e, p| e.add_path(PathBuf::from(p)))
    }

    fn roots(library: &str) -> LibraryRoots {
        LibraryRoots::for_library_root(Path::new(library))
    }

    #[test]
    fn classify_keeps_both_sides_of_a_rename() {
        let rename = event(
            EventKind::Modify(ModifyKind::Name(RenameMode::Both)),
            &["/m/a.mp3", "/m/b.mp3"],
        );
        assert_eq!(
            classify(&rename),
            Change::Paths(vec!["/m/a.mp3".into(), "/m/b.mp3".into()])
        );
    }

    #[test]
    fn classify_ignores_access_and_flags_rescans() {
        let access = event(EventKind::Access(AccessKind::Any), &["/m/a.mp3"]);
        assert_eq!(classify(&access), Change::Ignore);
        assert_eq!(classify(&Event::new(EventKind::Any)), Change::Ignore);
        let rescan = Event::new(EventKind::Other).set_flag(notify::event::Flag::Rescan);
        assert_eq!(classify(&rescan), Change::Rescan);
        let removed = event(EventKind::Remove(RemoveKind::File), &["/m/a.mp3"]);
        assert_eq!(classify(&removed), Change::Paths(vec!["/m/a.mp3".into()]));
    }

    #[test]
    fn pending_waits_for_quiet_and_coalesces() {
        let t0 = Instant::now();
        let mut p = Pending::default();
        p.record([PathBuf::from("/m/a.mp3")], t0);
        p.record(
            [PathBuf::from("/m/a.mp3"), PathBuf::from("/m/b.mp3")],
            t0 + Duration::from_millis(1000),
        );
        assert!(!p.is_due(t0 + Duration::from_millis(2000)));
        assert!(p.is_due(t0 + Duration::from_millis(2500)));
        assert_eq!(
            p.take(),
            Some(Batch::Paths(vec!["/m/a.mp3".into(), "/m/b.mp3".into()]))
        );
        assert!(p.is_empty());
        assert_eq!(p.take(), None);
    }

    #[test]
    fn pending_flushes_a_steady_stream_after_max_wait() {
        let t0 = Instant::now();
        let mut p = Pending::default();
        let mut now = t0;
        while now < t0 + MAX_WAIT {
            p.record([PathBuf::from("/m/a.mp3")], now);
            assert!(!p.is_due(now));
            now += Duration::from_millis(500);
        }
        p.record([PathBuf::from("/m/a.mp3")], now);
        assert!(p.is_due(now));
    }

    #[test]
    fn a_large_burst_becomes_a_full_reconcile() {
        let now = Instant::now();
        let mut p = Pending::default();
        p.record(
            (0..MAX_PATHS).map(|i| PathBuf::from(format!("/m/{i}.mp3"))),
            now,
        );
        assert!(!p.full);
        p.record([PathBuf::from("/m/one-more.mp3")], now);
        assert!(p.full);
        assert!(p.paths.is_empty());
        // Later paths don't pile up once the whole source is due.
        p.record([PathBuf::from("/m/later.mp3")], now);
        assert_eq!(p.take(), Some(Batch::All));
    }

    #[test]
    fn record_filters_paths_and_handles_rescans_and_errors() {
        let root = WatchRoot {
            root: "/music".into(),
            resolved: "/music".into(),
        };
        let lib = roots("/music/Spiral Library");
        let mut pending = HashMap::new();
        let send = |pending: &mut HashMap<_, _>, result| {
            let message = Message {
                source_id: 3,
                generation: 1,
                result,
            };
            record(pending, message, &root, &lib);
        };

        // Only the library changed: nothing to do for the watched source.
        send(
            &mut pending,
            Ok(event(
                EventKind::Create(CreateKind::File),
                &["/music/Spiral Library/Tracks/x.mp3", "/other/y.mp3"],
            )),
        );
        send(
            &mut pending,
            Ok(event(EventKind::Access(AccessKind::Any), &["/music/a.mp3"])),
        );
        assert!(pending.is_empty());

        send(
            &mut pending,
            Ok(event(
                EventKind::Create(CreateKind::File),
                &["/music/a.mp3", "/music/Spiral Library/Tracks/x.mp3"],
            )),
        );
        assert_eq!(
            pending.get_mut(&(3, 1)).unwrap().take(),
            Some(Batch::Paths(vec!["/music/a.mp3".into()]))
        );

        send(
            &mut pending,
            Ok(event(
                EventKind::Create(CreateKind::File),
                &["/music/a.mp3"],
            )),
        );
        send(
            &mut pending,
            Ok(Event::new(EventKind::Other).set_flag(notify::event::Flag::Rescan)),
        );
        assert_eq!(pending.get_mut(&(3, 1)).unwrap().take(), Some(Batch::All));

        send(&mut pending, Err(notify::Error::generic("overflow")));
        assert_eq!(pending.get_mut(&(3, 1)).unwrap().take(), Some(Batch::All));
    }

    #[test]
    fn accept_drops_paths_outside_the_root_and_in_the_library() {
        let root = WatchRoot {
            root: "/music".into(),
            resolved: "/music".into(),
        };
        let lib = roots("/music/Spiral Library");
        assert_eq!(
            root.accept(Path::new("/music/a/b.mp3"), &lib),
            Some("/music/a/b.mp3".into())
        );
        assert_eq!(root.accept(Path::new("/other/b.mp3"), &lib), None);
        assert_eq!(root.accept(Path::new("/musicians/b.mp3"), &lib), None);
        assert_eq!(
            root.accept(Path::new("/music/Spiral Library/Tracks/x.mp3"), &lib),
            None
        );
        assert_eq!(root.accept(Path::new("/music/Spiral Library"), &lib), None);
    }

    #[test]
    fn accept_maps_resolved_paths_back_to_the_stored_root() {
        let root = WatchRoot {
            root: "/tmp/music".into(),
            resolved: "/private/tmp/music".into(),
        };
        let lib = roots("/elsewhere/Spiral Library");
        assert_eq!(
            root.accept(Path::new("/private/tmp/music/a.mp3"), &lib),
            Some("/tmp/music/a.mp3".into())
        );
        assert_eq!(
            root.accept(Path::new("/tmp/music/a.mp3"), &lib),
            Some("/tmp/music/a.mp3".into())
        );
    }

    /// One real watcher: an event for a new file arrives and maps back into
    /// the stored root (the temp dir resolves through `/private` on macOS).
    #[test]
    fn real_watcher_reports_a_new_file() {
        let dir = std::env::temp_dir().join(format!(
            "spiral-source-watch-{}-{}",
            std::process::id(),
            Instant::now().elapsed().as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let root = WatchRoot::new(dir.clone());
        let (tx, rx) = mpsc::channel();
        let _watcher = watch_folder(&root, 7, 1, tx).unwrap();
        // FSEvents can miss changes made right after the stream starts.
        thread::sleep(Duration::from_millis(200));
        let file = dir.join("new.mp3");
        std::fs::write(&file, b"x").unwrap();

        let lib = roots("/nowhere/Spiral Library");
        let deadline = Instant::now() + Duration::from_secs(10);
        let mut seen = false;
        while !seen && Instant::now() < deadline {
            let Ok(message) = rx.recv_timeout(Duration::from_millis(500)) else {
                continue;
            };
            assert_eq!((message.source_id, message.generation), (7, 1));
            if let Ok(Change::Paths(paths)) = message.result.as_ref().map(classify) {
                seen = paths
                    .iter()
                    .any(|p| root.accept(p, &lib).as_deref() == Some(file.as_path()));
            }
        }
        let _ = std::fs::remove_dir_all(&dir);
        assert!(seen, "no event for {}", file.display());
    }

    #[test]
    fn watch_folder_refuses_a_missing_root() {
        let (tx, _rx) = mpsc::channel();
        let root = WatchRoot::new("/definitely/not/here/spiral".into());
        assert!(watch_folder(&root, 1, 1, tx).is_err());
    }
}
