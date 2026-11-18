//! File watchers for library sources: one recursive watcher per source
//! folder (there may be no sources at all), so files added, changed, renamed
//! or deleted there show up without a rescan.
//!
//! Events are coalesced per source until the folder has been quiet for
//! [`QUIET`], then that source's changed paths are reconciled off the event
//! thread. A large burst, or a platform rescan notice, reconciles the whole
//! source instead. A folder that can't be watched (an unplugged drive, or no
//! watcher at all) is retried every [`RETRY`]; until then it only updates at
//! startup and on a manual rescan.
//!
//! A source on a network share can stall rather than fail when the connection
//! drops, so nothing here looks at a source's folder while holding the
//! registry lock, and every look is bounded (see [`fs_probe`]).

use crate::commands::library::DbState;
use crate::commands::sources::reconcile_and_notify;
use crate::fs_probe::{self, Probed};
use crate::settings;
use crate::source_scan::{is_hidden_below, ReconcileScope};
use crate::sources::{self, LibraryRoots};
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
/// How long starting a watcher may take before the folder is treated as
/// unreachable and retried later.
const ATTACH_TIMEOUT: Duration = Duration::from_secs(5);

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
    /// root, hidden, in the Spiral folder's data (a source may contain the
    /// Spiral folder) or in another source nested in this one.
    fn accept(&self, path: &Path, roots: &LibraryRoots) -> Option<PathBuf> {
        let path = match path.strip_prefix(&self.resolved) {
            Ok(rest) if self.resolved != self.root => self.root.join(rest),
            _ => path.to_path_buf(),
        };
        (path.starts_with(&self.root)
            && !is_hidden_below(&path, &self.root)
            && !sources::is_outside_source_walk(&path, &self.root, roots))
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

/// Whether a watched folder is being watched right now.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum WatchStatus {
    /// Changes in the folder show up live.
    Watching,
    /// The folder can't be reached (an unplugged drive, or it was moved or
    /// deleted); it is retried every [`RETRY`].
    Unreachable,
    /// No watcher for this source, e.g. the watcher thread never started.
    NotWatching,
}

/// The watch status of each given source. Looks at each folder now (the
/// worker only checks a quiet one every [`RETRY`]), but never for longer than a
/// probe timeout and never while holding the registry lock, so a dropped
/// network share reads as unreachable instead of hanging the caller.
pub fn statuses(source_ids: &[i64]) -> Vec<(i64, WatchStatus)> {
    let snapshot: Vec<(i64, Option<(PathBuf, bool)>)> = {
        let registry = REGISTRY.get().map(lock);
        source_ids
            .iter()
            .map(|&id| (id, registry.as_ref().and_then(|r| r.snapshot(id))))
            .collect()
    };
    let roots: Vec<PathBuf> = snapshot
        .iter()
        .filter_map(|(_, watch)| watch.as_ref().map(|(root, _)| root.clone()))
        .collect();
    let mut probed = fs_probe::probe_dirs(&roots).into_iter();
    snapshot
        .into_iter()
        .map(|(id, watch)| {
            let status = match watch {
                None => WatchStatus::NotWatching,
                Some((_, watching)) => {
                    status_from(watching, probed.next().unwrap_or(Probed::Stalled))
                }
            };
            (id, status)
        })
        .collect()
}

/// A source with a watch is watched live only while its folder answers.
fn status_from(has_watcher: bool, folder: Probed) -> WatchStatus {
    if has_watcher && folder.is_yes() {
        WatchStatus::Watching
    } else {
        WatchStatus::Unreachable
    }
}

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

/// Probe `root`, then start a watcher on it, waiting for neither longer than
/// the probe and [`ATTACH_TIMEOUT`]. A stalled folder is an error, as when it's
/// missing, so the caller retries it later.
fn try_watch(
    root: &Path,
    source_id: i64,
    generation: u64,
    tx: Sender<Message>,
) -> Result<(WatchRoot, RecommendedWatcher), String> {
    match fs_probe::probe_dir(root) {
        Probed::Yes => {}
        Probed::No => return Err("folder not found".into()),
        Probed::Stalled => return Err("folder is not responding".into()),
    }
    let owned = root.to_path_buf();
    fs_probe::run_within(ATTACH_TIMEOUT, move || {
        let root = WatchRoot::new(owned);
        watch_folder(&root, source_id, generation, tx).map(|watcher| (root, watcher))
    })
    .unwrap_or_else(|| Err("starting the watcher timed out".into()))
}

/// A watch for `root`, watching it unless that fails (then retried at `RETRY`).
fn new_watch(root: PathBuf, source_id: i64, generation: u64, tx: Sender<Message>) -> Watch {
    match try_watch(&root, source_id, generation, tx) {
        Ok((root, watcher)) => Watch {
            root,
            generation,
            watcher: Some(watcher),
            retry_at: Instant::now() + RETRY,
        },
        Err(err) => {
            eprintln!(
                "source watch: can't watch {} (source {source_id}): {err}; retrying every {}s",
                root.display(),
                RETRY.as_secs()
            );
            Watch {
                root: WatchRoot {
                    resolved: root.clone(),
                    root,
                },
                generation,
                watcher: None,
                retry_at: Instant::now() + RETRY,
            }
        }
    }
}

impl Registry {
    fn next_generation(&mut self) -> u64 {
        self.next_generation += 1;
        self.next_generation
    }

    /// A source's folder and whether it has a watcher, without looking at the
    /// folder.
    fn snapshot(&self, source_id: i64) -> Option<(PathBuf, bool)> {
        self.watches
            .get(&source_id)
            .map(|watch| (watch.root.root.clone(), watch.watcher.is_some()))
    }

    /// The source's root when `generation` is still its current watcher.
    fn current_root(&self, source_id: i64, generation: u64) -> Option<&WatchRoot> {
        self.watches
            .get(&source_id)
            .filter(|w| w.generation == generation)
            .map(|w| &w.root)
    }
}

/// One `sync` at a time, so two never start a watcher for the same source.
static SYNC_LOCK: Mutex<()> = Mutex::new(());

/// Make the running watchers match the open library's watched sources. Call
/// after a source is added, removed or relocated, or the library changes.
/// Starts the watcher thread on first use. Starting a watcher looks at the
/// folder, which can be slow on a network share: call this off the main thread.
pub fn sync(app: &AppHandle) {
    let _serial = lock(&SYNC_LOCK);
    let (wanted, roots): (HashMap<i64, PathBuf>, LibraryRoots) = {
        let state = app.state::<DbState>();
        let conn = lock(&state.0);
        let roots = match library_roots(app).with_sources(&conn) {
            Ok(roots) => roots,
            Err(err) => {
                eprintln!("source watch: list sources: {err}");
                return;
            }
        };
        let wanted = match sources::list_sources(&conn) {
            Ok(list) => list
                .into_iter()
                .filter_map(|s| Some((s.id, PathBuf::from(s.root_path?))))
                .collect(),
            Err(err) => {
                eprintln!("source watch: list sources: {err}");
                return;
            }
        };
        (wanted, roots)
    };

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
    let (tx, to_attach) = {
        let mut registry = lock(registry);
        registry.roots = roots;
        registry
            .watches
            .retain(|id, w| wanted.get(id) == Some(&w.root.root));
        let mut to_attach = Vec::new();
        for (id, root) in wanted {
            if !registry.watches.contains_key(&id) {
                to_attach.push((id, root, registry.next_generation()));
            }
        }
        (registry.tx.clone(), to_attach)
    };

    // Starting a watcher looks at the folder, so the registry is unlocked
    // meanwhile: status polls and the worker don't wait on a dead share.
    let attached: Vec<(i64, Watch)> = thread::scope(|scope| {
        let handles: Vec<_> = to_attach
            .into_iter()
            .map(|(id, root, generation)| {
                let tx = tx.clone();
                scope.spawn(move || (id, new_watch(root, id, generation, tx)))
            })
            .collect();
        handles
            .into_iter()
            .filter_map(|handle| handle.join().ok())
            .collect()
    });
    let mut registry = lock(registry);
    for (id, watch) in attached {
        registry.watches.insert(id, watch);
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
        let Some(registry_lock) = REGISTRY.get() else {
            continue;
        };
        let mut registry = lock(registry_lock);
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

        // The folder itself may have gone away (an unplugged drive, a dropped
        // share): then stop watching it and reconcile everything, which marks
        // its tracks missing. A due source's folder is looked at now; the
        // others every `RETRY`. Looking can stall, so the registry is unlocked
        // meanwhile: a status poll mustn't wait on a dead share.
        let check_roots = now >= next_check;
        if check_roots {
            next_check = now + RETRY;
        }
        let mut to_look = Vec::new();
        let mut to_retry = Vec::new();
        for (&id, watch) in registry.watches.iter_mut() {
            let target = (id, watch.generation, watch.root.root.clone());
            if watch.watcher.is_some() {
                if check_roots || due.iter().any(|(due_id, _)| *due_id == id) {
                    to_look.push(target);
                }
            } else if now >= watch.retry_at {
                watch.retry_at = now + RETRY;
                to_retry.push(target);
            }
        }
        let tx = registry.tx.clone();
        drop(registry);

        let looked = look_at_roots(&to_look);
        let retried = retry_watches(to_retry, &tx);

        let mut registry = lock(registry_lock);
        apply_checks(&mut registry, &mut due, &looked, retried);
        drop(registry);

        for (id, batch) in due {
            reconcile_in_background(&app, &busy, id, batch);
        }
    }
}

/// Which of the watched `(source, generation, folder)`s still answer, looked
/// at together (and so waited for together, if a share has dropped).
fn look_at_roots(roots: &[(i64, u64, PathBuf)]) -> Vec<(i64, u64, Probed)> {
    let paths: Vec<PathBuf> = roots.iter().map(|(_, _, root)| root.clone()).collect();
    roots
        .iter()
        .zip(fs_probe::probe_dirs(&paths))
        .map(|(&(id, generation, _), probed)| (id, generation, probed))
        .collect()
}

/// A new watcher for each unwatched folder that answers again, started
/// together.
fn retry_watches(
    roots: Vec<(i64, u64, PathBuf)>,
    tx: &Sender<Message>,
) -> Vec<(i64, u64, WatchRoot, RecommendedWatcher)> {
    thread::scope(|scope| {
        let handles: Vec<_> = roots
            .into_iter()
            .map(|(id, generation, root)| {
                let tx = tx.clone();
                scope.spawn(move || {
                    try_watch(&root, id, generation, tx)
                        .ok()
                        .map(|(root, watcher)| (id, generation, root, watcher))
                })
            })
            .collect();
        handles
            .into_iter()
            .filter_map(|handle| handle.join().ok().flatten())
            .collect()
    })
}

/// Reconcile all of `source_id`, instead of what was due for it.
fn require_full(due: &mut Vec<(i64, Batch)>, source_id: i64) {
    match due.iter_mut().find(|(id, _)| *id == source_id) {
        Some((_, batch)) => *batch = Batch::All,
        None => due.push((source_id, Batch::All)),
    }
}

/// Act on what [`look_at_roots`] and [`retry_watches`] found, skipping a
/// source whose watch was replaced meanwhile: a watched folder that no longer
/// answers is given up on, and an unwatched one that does is watched again;
/// either way the whole source is reconciled.
fn apply_checks(
    registry: &mut Registry,
    due: &mut Vec<(i64, Batch)>,
    looked: &[(i64, u64, Probed)],
    retried: Vec<(i64, u64, WatchRoot, RecommendedWatcher)>,
) {
    for &(id, generation, probed) in looked {
        if probed.is_yes() {
            continue;
        }
        if let Some(watch) = registry
            .watches
            .get_mut(&id)
            .filter(|w| w.generation == generation && w.watcher.is_some())
        {
            lost(watch, id);
            require_full(due, id);
        }
    }
    for (id, generation, root, watcher) in retried {
        if let Some(watch) = registry
            .watches
            .get_mut(&id)
            .filter(|w| w.generation == generation && w.watcher.is_none())
        {
            eprintln!(
                "source watch: watching {} again (source {id})",
                watch.root.root.display()
            );
            watch.root = root;
            watch.watcher = Some(watcher);
            require_full(due, id);
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

    /// The Spiral folder at `library`, with `/music` and the Spiral folder's
    /// `Tracks` as sources (a library from before sources couldn't overlap).
    fn roots(library: &str) -> LibraryRoots {
        let mut roots = LibraryRoots::for_library_root(Path::new(library));
        roots.source_roots = vec!["/music".into(), Path::new(library).join("Tracks")];
        roots
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
    fn accept_drops_paths_outside_the_root_in_spiral_data_and_nested_sources() {
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
        assert_eq!(
            root.accept(Path::new("/music/Spiral Library/Packs/x.wav"), &lib),
            None
        );
        assert_eq!(
            root.accept(Path::new("/music/Spiral Library/Library.db"), &lib),
            None
        );
        // The rest of the Spiral folder is an ordinary folder.
        assert_eq!(
            root.accept(Path::new("/music/Spiral Library/Loose/x.mp3"), &lib),
            Some("/music/Spiral Library/Loose/x.mp3".into())
        );
        assert_eq!(root.accept(Path::new("/music/a/.b.mp3"), &lib), None);
    }

    #[test]
    fn accept_keeps_a_spiral_folder_sources_own_files() {
        let lib = roots("/music/Spiral Library");
        let tracks = PathBuf::from("/music/Spiral Library/Tracks");
        let root = WatchRoot {
            root: tracks.clone(),
            resolved: tracks,
        };
        assert_eq!(
            root.accept(Path::new("/music/Spiral Library/Tracks/A/x.mp3"), &lib),
            Some("/music/Spiral Library/Tracks/A/x.mp3".into())
        );
        assert_eq!(
            root.accept(Path::new("/music/Spiral Library/Packs/x.wav"), &lib),
            None
        );
        assert_eq!(
            root.accept(
                Path::new("/music/Spiral Library/Tracks/.spiral-convert/1.m4a"),
                &lib
            ),
            None
        );
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

    fn registry() -> Registry {
        let (tx, _rx) = mpsc::channel();
        Registry {
            watches: HashMap::new(),
            roots: roots("/nowhere/Spiral Library"),
            tx,
            next_generation: 0,
        }
    }

    fn attach(registry: &mut Registry, id: i64, root: PathBuf) {
        let generation = registry.next_generation();
        let watch = new_watch(root, id, generation, registry.tx.clone());
        registry.watches.insert(id, watch);
    }

    fn temp_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "spiral-source-{label}-{}-{}",
            std::process::id(),
            Instant::now().elapsed().as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn status_of(registry: &Registry, id: i64) -> WatchStatus {
        match registry.snapshot(id) {
            None => WatchStatus::NotWatching,
            Some((root, watching)) => status_from(watching, fs_probe::probe_dir(&root)),
        }
    }

    #[test]
    fn status_reports_watching_unreachable_and_unknown_sources() {
        let dir = temp_dir("status");
        let mut registry = registry();
        attach(&mut registry, 3, dir.clone());
        attach(&mut registry, 4, "/definitely/not/here/spiral".into());

        assert_eq!(status_of(&registry, 3), WatchStatus::Watching);
        assert_eq!(status_of(&registry, 4), WatchStatus::Unreachable);
        assert_eq!(status_of(&registry, 5), WatchStatus::NotWatching);

        // Gone before the worker noticed, so it still has a watcher.
        std::fs::remove_dir_all(&dir).unwrap();
        assert_eq!(status_of(&registry, 3), WatchStatus::Unreachable);

        std::fs::create_dir_all(&dir).unwrap();
        if let Some(watch) = registry.watches.get_mut(&3) {
            lost(watch, 3);
        }
        assert_eq!(status_of(&registry, 3), WatchStatus::Unreachable);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_stalled_folder_reads_as_unreachable_even_with_a_watcher() {
        assert_eq!(status_from(true, Probed::Yes), WatchStatus::Watching);
        assert_eq!(status_from(true, Probed::No), WatchStatus::Unreachable);
        assert_eq!(status_from(true, Probed::Stalled), WatchStatus::Unreachable);
        assert_eq!(status_from(false, Probed::Yes), WatchStatus::Unreachable);
    }

    #[test]
    fn a_stalled_share_reads_unreachable_at_once_and_recovers() {
        let dir = temp_dir("status-stalled");
        let mut registry = registry();
        attach(&mut registry, 3, dir.clone());
        assert_eq!(status_of(&registry, 3), WatchStatus::Watching);

        let stall = fs_probe::stall_dir(&dir);
        let started = Instant::now();
        assert_eq!(status_of(&registry, 3), WatchStatus::Unreachable);
        assert!(started.elapsed() < Duration::from_millis(500));

        drop(stall);
        assert_eq!(status_of(&registry, 3), WatchStatus::Watching);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn attaching_to_a_stalled_share_doesnt_wait_and_leaves_it_to_retry() {
        let dir = temp_dir("attach-stalled");
        let _stall = fs_probe::stall_dir(&dir);
        let mut registry = registry();
        let started = Instant::now();
        attach(&mut registry, 3, dir.clone());
        assert!(started.elapsed() < Duration::from_millis(500));
        assert!(registry.watches[&3].watcher.is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_watched_folder_that_stops_answering_is_given_up_and_reconciled_whole() {
        let dir = temp_dir("apply-lost");
        let mut registry = registry();
        attach(&mut registry, 3, dir.clone());
        let generation = registry.watches[&3].generation;
        assert!(registry.watches[&3].watcher.is_some());

        // A file change was already due for it: the whole source is now.
        let mut due = vec![(3, Batch::Paths(vec![dir.join("a.mp3")]))];
        apply_checks(
            &mut registry,
            &mut due,
            &[(3, generation, Probed::Stalled)],
            Vec::new(),
        );
        assert!(registry.watches[&3].watcher.is_none());
        assert_eq!(due, vec![(3, Batch::All)]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_folder_that_answers_again_is_watched_again_and_reconciled_whole() {
        let dir = temp_dir("apply-back");
        let mut registry = registry();
        // Unwatched, as when the share was down at startup.
        attach(&mut registry, 3, "/definitely/not/here/spiral".into());
        let generation = registry.watches[&3].generation;
        assert!(registry.watches[&3].watcher.is_none());

        let (root, watcher) = try_watch(&dir, 3, generation, registry.tx.clone()).unwrap();
        let mut due = Vec::new();
        apply_checks(
            &mut registry,
            &mut due,
            &[],
            vec![(3, generation, root, watcher)],
        );
        assert!(registry.watches[&3].watcher.is_some());
        assert_eq!(due, vec![(3, Batch::All)]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn results_for_a_replaced_watch_are_ignored() {
        let dir = temp_dir("apply-stale");
        let mut registry = registry();
        attach(&mut registry, 3, dir.clone());
        let stale = registry.watches[&3].generation - 1;
        let mut due = Vec::new();
        apply_checks(
            &mut registry,
            &mut due,
            &[(3, stale, Probed::No)],
            Vec::new(),
        );
        assert!(registry.watches[&3].watcher.is_some());
        assert!(due.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn statuses_is_unknown_before_any_watcher_starts() {
        // No registry yet in this process, or none for these ids.
        let statuses = statuses(&[987_654]);
        assert_eq!(statuses, vec![(987_654, WatchStatus::NotWatching)]);
    }

    #[test]
    fn watch_status_serializes_in_camel_case() {
        assert_eq!(
            serde_json::to_string(&WatchStatus::NotWatching).unwrap(),
            "\"notWatching\""
        );
    }

    #[test]
    fn watch_folder_refuses_a_missing_root() {
        let (tx, _rx) = mpsc::channel();
        let root = WatchRoot::new("/definitely/not/here/spiral".into());
        assert!(watch_folder(&root, 1, 1, tx).is_err());
    }
}
