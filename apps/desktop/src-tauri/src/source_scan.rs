//! Keeping each source's tracks in step with the files on disk.
//!
//! Reconciling a source walks its folder: new audio files become tracks of
//! that source (read in place, never moved), files whose size or modification
//! time changed since they were last read are read again, and tracks whose
//! file is gone get `missing_since`. A track is never deleted here; when its
//! file comes back the mark is cleared. Every source's folder is walked,
//! wherever it is. Hidden files and folders (e.g. `.spiral-convert`) are
//! skipped.
//!
//! A file found on disk matches a row by the file, not the path string: on a
//! case- or normalization-insensitive volume a row may hold another spelling
//! of the path (after a rename that only changed case), and that row is
//! re-pointed to the spelling on disk rather than marked missing beside a new
//! duplicate.
//!
//! A file with no row of its own may be a track's file moved within the
//! source: when exactly one of the source's rows has lost its file and stored
//! this file's size and modification time, that row follows the file, keeping
//! its play count and playlist entries. Moves between sources aren't detected.
//!
//! Reconciling is idempotent and serialized, so the startup pass, a manual
//! rescan and the file watcher can all call it. Files are read without holding
//! the database lock, and the lock is taken briefly for each write.

use crate::art_cache;
use crate::artwork_organize;
use crate::audio_formats::is_supported_audio_file;
use crate::db;
use crate::fs_probe::{self, Probed};
use crate::lyrics_normalize;
use crate::metadata_reader;
use crate::sources::{self, LibraryRoots, SourceRoots};
use crate::track_identity;
use chrono::Utc;
use rusqlite::{params, Connection};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant, UNIX_EPOCH};

/// What reconciling needs to know about the app, gathered once per run.
#[derive(Debug, Clone)]
pub struct ScanContext {
    pub app_data_dir: PathBuf,
    pub roots: LibraryRoots,
    pub lyrics_sidecar_enabled: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReconcileSummary {
    pub source_id: i64,
    pub added: u32,
    pub updated: u32,
    pub missing: u32,
    pub restored: u32,
    /// Rows that followed their file to a new path. A moved row counts only
    /// here, even if it had been marked missing.
    pub moved: u32,
    pub failed: u32,
    pub errors: Vec<String>,
}

impl ReconcileSummary {
    fn new(source_id: i64) -> Self {
        Self {
            source_id,
            ..Self::default()
        }
    }

    /// True when any track row changed.
    pub fn changed(&self) -> bool {
        self.added + self.updated + self.missing + self.restored + self.moved > 0
    }

    fn fail(&mut self, path: &str, err: impl std::fmt::Display) {
        self.failed += 1;
        if self.errors.len() < MAX_ERRORS {
            self.errors.push(format!("{path}: {err}"));
        }
    }
}

const MAX_ERRORS: usize = 20;

/// Where a reconcile is, for showing its progress.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", tag = "phase")]
pub enum ScanProgress {
    /// Listing the audio files in the folder; the total isn't known yet.
    Walking { found: usize },
    /// Comparing each file with the library, reading the new and changed
    /// ones. `current` counts the files done, in whatever order they finish.
    Reading { current: usize, total: usize },
}

/// Receives progress while a reconcile runs. Called often, and from several
/// threads at once while files are read: throttle in the receiver.
pub type ProgressFn<'a> = &'a (dyn Fn(ScanProgress) + Sync);

/// Least time between the walk's progress reports.
const WALK_REPORT_EVERY: Duration = Duration::from_millis(150);

/// Which part of a source to look at.
#[derive(Debug, Clone, Copy)]
pub enum ReconcileScope<'a> {
    /// The whole source.
    All,
    /// Only these files and folders, e.g. what a file watcher reported. Paths
    /// outside a watched source's root are ignored.
    Paths(&'a [PathBuf]),
}

/// One reconcile at a time, so two passes never read and insert the same file.
pub(crate) static RECONCILE_LOCK: Mutex<()> = Mutex::new(());

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// Hold off every reconcile (the watcher's included) while the guard lives.
/// The file planner holds it while it moves files and updates their rows, so
/// a reconcile never sees a file moved before its row was, and the watcher's
/// reconcile of those moves afterwards finds nothing to change.
pub fn exclusive() -> std::sync::MutexGuard<'static, ()> {
    lock(&RECONCILE_LOCK)
}

/// Size and modification time (ms since the epoch) of a regular file.
fn file_stat(path: &Path) -> Option<(i64, i64)> {
    let meta = std::fs::metadata(path).ok().filter(|m| m.is_file())?;
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_millis() as i64);
    Some((meta.len() as i64, mtime))
}

#[derive(Clone)]
struct KnownTrack {
    id: i64,
    stat: Option<(i64, i64)>,
    missing: bool,
}

/// How many files are read, then written in one transaction, at a time.
const WRITE_BATCH: usize = 100;

/// What reconciling does for one file found on disk.
struct ScanJob {
    path: String,
    stat: (i64, i64),
    /// The row it belongs to, if any.
    row: Option<KnownTrack>,
    /// The row's file moved here.
    moved: bool,
    /// The row to point at this path first (a move or respelling).
    repoint: Option<i64>,
    /// The row's file changed since it was read.
    read: bool,
}

/// What a set of paths covers: whole folders and single files.
struct Coverage {
    dirs: Vec<PathBuf>,
    files: HashSet<PathBuf>,
}

impl Coverage {
    fn contains(&self, path: &Path) -> bool {
        self.files.contains(path) || self.dirs.iter().any(|d| path.starts_with(d))
    }
}

/// For a source with a folder (`root` given), paths outside its root, in the
/// Spiral folder's data or another source nested in it, or hidden are dropped.
fn coverage(
    scope: ReconcileScope<'_>,
    root: Option<&Path>,
    roots: &LibraryRoots,
) -> Option<Coverage> {
    let ReconcileScope::Paths(paths) = scope else {
        return None;
    };
    let mut dirs = Vec::new();
    let mut files = HashSet::new();
    for path in paths {
        if root.is_some_and(|root| {
            !path.starts_with(root)
                || sources::is_outside_source_walk(path, root, roots)
                || is_hidden_below(path, root)
        }) {
            continue;
        }
        // A path that no longer exists may have been a folder (deleted or
        // renamed away), so it covers whatever was under it as well.
        if path.is_dir() || !path.exists() {
            dirs.push(path.clone());
        } else {
            files.insert(path.clone());
        }
    }
    Some(Coverage { dirs, files })
}

fn known_tracks(
    conn: &Connection,
    source_id: i64,
    coverage: Option<&Coverage>,
) -> Result<HashMap<String, KnownTrack>, String> {
    let roots = SourceRoots::load(conn).map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, rel_path, file_size, file_mtime_ms, missing_since IS NOT NULL
             FROM tracks WHERE source_id = ?1",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![source_id], |row| {
            let size: Option<i64> = row.get(2)?;
            let mtime: Option<i64> = row.get(3)?;
            Ok((
                roots.resolve(source_id, &row.get::<_, String>(1)?),
                KnownTrack {
                    id: row.get(0)?,
                    stat: size.zip(mtime),
                    missing: row.get(4)?,
                },
            ))
        })
        .map_err(|e| e.to_string())?;
    let mut known = HashMap::new();
    for row in rows {
        let (path, track) = row.map_err(|e| e.to_string())?;
        if coverage.is_none_or(|c| c.contains(Path::new(&path))) {
            known.insert(path, track);
        }
    }
    Ok(known)
}

/// All of a source's tracks, for finding the row of a file with no row under
/// its exact path.
struct SourceRows {
    /// By [`track_identity::path_key`], for a path spelled differently on
    /// disk (another case or Unicode form) than in the database.
    by_key: HashMap<String, Vec<(String, KnownTrack)>>,
    /// By stored size and modification time, for a file that moved.
    by_stat: HashMap<(i64, i64), Vec<(String, KnownTrack)>>,
}

fn source_rows(conn: &Connection, source_id: i64) -> Result<SourceRows, String> {
    let mut rows = SourceRows {
        by_key: HashMap::new(),
        by_stat: HashMap::new(),
    };
    for (path, track) in known_tracks(conn, source_id, None)? {
        if let Some(stat) = track.stat {
            rows.by_stat
                .entry(stat)
                .or_default()
                .push((path.clone(), track.clone()));
        }
        rows.by_key
            .entry(track_identity::path_key(&path))
            .or_default()
            .push((path, track));
    }
    Ok(rows)
}

/// The row stored under another spelling of `path` that names the same file,
/// skipping rows already matched in this pass.
fn equivalent_track(
    by_key: &mut HashMap<String, Vec<(String, KnownTrack)>>,
    matched: &HashSet<i64>,
    path: &str,
) -> Option<(String, KnownTrack)> {
    let rows = by_key.get_mut(&track_identity::path_key(path))?;
    let at = rows.iter().position(|(stored, track)| {
        stored != path
            && !matched.contains(&track.id)
            && track_identity::same_file(Path::new(stored), Path::new(path))
    })?;
    Some(rows.swap_remove(at))
}

/// The row a file with `stat` moved away from: the only one with that stored
/// stat whose own file is gone, already marked missing or not. Two such rows
/// could be either file, so neither is picked.
fn moved_track(
    by_stat: &HashMap<(i64, i64), Vec<(String, KnownTrack)>>,
    matched: &HashSet<i64>,
    stat: (i64, i64),
) -> Option<(String, KnownTrack)> {
    let mut gone = by_stat.get(&stat)?.iter().filter(|(stored, track)| {
        !matched.contains(&track.id) && matches!(Path::new(stored).try_exists(), Ok(false))
    });
    let row = gone.next()?;
    gone.next().is_none().then(|| row.clone())
}

/// Point a track at the path its file is at now.
fn set_path(conn: &Connection, source_id: i64, id: i64, path: &str) -> Result<(), String> {
    let rel = SourceRoots::load(conn)
        .map_err(|e| e.to_string())?
        .relative_path(source_id, Path::new(path))?;
    conn.execute(
        "UPDATE tracks SET rel_path = ?1 WHERE id = ?2",
        params![rel, id],
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
}

fn set_missing(conn: &Connection, id: i64, missing: bool) -> Result<(), String> {
    let since = missing.then(|| Utc::now().to_rfc3339());
    conn.execute(
        "UPDATE tracks SET missing_since = ?1 WHERE id = ?2",
        params![since, id],
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
}

fn set_present(conn: &Connection, id: i64, stat: (i64, i64)) -> Result<(), String> {
    conn.execute(
        "UPDATE tracks SET file_size = ?1, file_mtime_ms = ?2, missing_since = NULL WHERE id = ?3",
        params![stat.0, stat.1, id],
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
}

fn source_exists(conn: &Connection, id: i64) -> bool {
    sources::get_source(conn, id).ok().flatten().is_some()
}

/// Reconcile one source (or part of it) with the disk. Safe to call
/// repeatedly; a pass over unchanged files changes nothing. Blocking: call it
/// off the main thread.
pub fn reconcile_source(
    db: &Mutex<Connection>,
    ctx: &ScanContext,
    source_id: i64,
    scope: ReconcileScope<'_>,
) -> Result<ReconcileSummary, String> {
    reconcile_source_with_progress(db, ctx, source_id, scope, None)
}

/// [`reconcile_source`], reporting progress to `progress` as it goes.
pub fn reconcile_source_with_progress(
    db: &Mutex<Connection>,
    ctx: &ScanContext,
    source_id: i64,
    scope: ReconcileScope<'_>,
    progress: Option<ProgressFn<'_>>,
) -> Result<ReconcileSummary, String> {
    let _serial = lock(&RECONCILE_LOCK);
    let source = sources::get_source(&lock(db), source_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Source {source_id} not found"))?;
    // A source whose folder isn't known (inside an unknown Spiral folder)
    // has nothing to compare against, so it is left alone.
    match source.root_path.as_deref() {
        Some(root) => reconcile_watched(db, ctx, source_id, root, scope, progress),
        None => Ok(ReconcileSummary::new(source_id)),
    }
}

/// Merge rows an earlier scan duplicated under another spelling of a path.
pub fn merge_duplicate_rows(db: &Mutex<Connection>) {
    let _serial = lock(&RECONCILE_LOCK);
    match track_identity::merge_duplicate_tracks(&lock(db)) {
        Ok(0) => {}
        Ok(n) => eprintln!("merged {n} duplicate track rows"),
        Err(err) => eprintln!("merge duplicate tracks: {err}"),
    }
}

/// Reconcile every source: merge rows that name the same file, then a full
/// pass over each source's folder. Catches what changed while Spiral was
/// closed. (The app does this per source, to report progress.)
#[cfg(test)]
pub fn reconcile_all(db: &Mutex<Connection>, ctx: &ScanContext) -> Vec<ReconcileSummary> {
    merge_duplicate_rows(db);
    let ids = match sources::list_sources(&lock(db)) {
        Ok(list) => list.into_iter().map(|s| s.id).collect::<Vec<_>>(),
        Err(err) => {
            eprintln!("reconcile sources: {err}");
            return Vec::new();
        }
    };
    ids.into_iter()
        .filter_map(
            |id| match reconcile_source(db, ctx, id, ReconcileScope::All) {
                Ok(summary) => Some(summary),
                Err(err) => {
                    eprintln!("reconcile source {id}: {err}");
                    None
                }
            },
        )
        .collect()
}

/// Set or clear `missing_since` from whether each track's file exists.
fn reconcile_watched(
    db: &Mutex<Connection>,
    ctx: &ScanContext,
    source_id: i64,
    root: &str,
    scope: ReconcileScope<'_>,
    progress: Option<ProgressFn<'_>>,
) -> Result<ReconcileSummary, String> {
    let root = PathBuf::from(root);
    // A folder that isn't there (an unplugged drive) or doesn't answer (a
    // dropped network share, which would stall a walk, and the lock every
    // pass shares, indefinitely) is offline, not empty: say so and leave the
    // rows as they are. Its tracks aren't missing; missing is for a file that's
    // gone from a folder that's there.
    //
    // Only the root is checked up front. A share that drops partway through
    // the walk below can still stall it (and the lock every pass shares)
    // until the share's own timeout; bounding every read in the walk is out
    // of scope here.
    match fs_probe::probe_dir_before_use(&root) {
        Probed::Yes => {}
        Probed::No => {
            return Err(format!(
                "{}: the folder {} is not available",
                sources::SOURCE_UNAVAILABLE,
                root.display()
            ))
        }
        Probed::Stalled => return Err(sources::not_responding(&root)),
    }
    // Knowing every source's folder, the walk skips one nested in this one.
    let roots = ctx
        .roots
        .clone()
        .with_sources(&lock(db))
        .map_err(|e| e.to_string())?;
    let coverage = coverage(scope, Some(&root), &roots).unwrap_or_else(|| Coverage {
        dirs: vec![root.clone()],
        files: HashSet::new(),
    });

    let mut found: Vec<String> = Vec::new();
    for dir in &coverage.dirs {
        let base = found.len();
        let mut report = |n: usize| {
            if let Some(p) = progress {
                p(ScanProgress::Walking { found: base + n });
            }
        };
        found.extend(audio_files_in_source(dir, &root, &roots, &mut report));
    }
    found.extend(
        coverage
            .files
            .iter()
            .filter(|f| f.is_file() && is_supported_audio_file(f))
            .map(|f| f.to_string_lossy().into_owned()),
    );
    found.sort();
    found.dedup();

    let mut known = known_tracks(&lock(db), source_id, Some(&coverage))?;
    // Files the user removed from the library but left on disk: a file with
    // no row that is one of these is not added back.
    let removed = db::removed_tracks(&lock(db), source_id).map_err(|e| e.to_string())?;
    let removed_keys: HashSet<&str> = removed.iter().map(|(_, key)| key.as_str()).collect();
    let mut seen_removed: HashSet<String> = HashSet::new();
    let mut summary = ReconcileSummary::new(source_id);
    // Loaded the first time a file has no row under its exact path.
    let mut rows = None;
    let mut matched = HashSet::new();

    let total = found.len();
    let mut done = 0;
    let mut remaining = found.into_iter();
    loop {
        let chunk: Vec<String> = remaining.by_ref().take(WRITE_BATCH).collect();
        if chunk.is_empty() {
            break;
        }

        // 1. Decide what each file needs, from what's in memory. Each file is
        // looked at (a round trip on a network folder), a few at a time.
        let stats = par_map(&chunk, |path| file_stat(Path::new(path)));
        let mut jobs = Vec::with_capacity(chunk.len());
        for (path, stat) in chunk.into_iter().zip(stats) {
            let Some(stat) = stat else {
                done += 1;
                continue;
            };
            let mut row = known.remove(&path);
            let mut moved = false;
            let mut repoint = None;
            if row.is_none() {
                if rows.is_none() {
                    rows = Some(source_rows(&lock(db), source_id)?);
                }
                let SourceRows { by_key, by_stat } = rows.as_mut().unwrap();
                // A row may hold another spelling of this file's path, e.g.
                // after a rename that only changed case on a case-insensitive
                // volume. Or this may be a row's file, moved. Either way,
                // re-point that row rather than adding a second one for the
                // file. The row may be outside this pass's scope, as when a
                // watcher reports a move's two halves separately.
                let respelled = equivalent_track(by_key, &matched, &path);
                let relocated = match respelled {
                    Some(_) => None,
                    None => moved_track(by_stat, &matched, stat),
                };
                moved = relocated.is_some();
                if let Some((stored, track)) = respelled.or(relocated) {
                    known.remove(&stored);
                    repoint = Some(track.id);
                    row = Some(track);
                }
            }
            if let Some(track) = &row {
                matched.insert(track.id);
            } else if !removed_keys.is_empty() {
                let key = sources::relative_to(Path::new(&path), &root)
                    .map(|rel| track_identity::path_key(&rel));
                if let Some(key) = key.filter(|k| removed_keys.contains(k.as_str())) {
                    seen_removed.insert(key);
                    done += 1;
                    continue;
                }
            }
            // A NULL stat predates change tracking: record it and trust the
            // row, rather than re-reading every file once.
            let changed = row
                .as_ref()
                .is_some_and(|t| t.stat.is_some_and(|s| s != stat));
            jobs.push(ScanJob {
                path,
                stat,
                row,
                moved,
                repoint,
                read: changed,
            });
        }

        // 2. Read the files that are new or changed, without the database
        // lock, a few at a time, and place their pictures, one at a time: they
        // share the artwork folders.
        let wanted: Vec<Option<&str>> = jobs
            .iter()
            .map(|job| (job.row.is_none() || job.read).then_some(job.path.as_str()))
            .collect();
        // Files that need no read are finished already.
        done += wanted.iter().filter(|w| w.is_none()).count();
        let finished_reads = AtomicUsize::new(0);
        let base = done;
        let on_read = || {
            let n = finished_reads.fetch_add(1, Ordering::Relaxed) + 1;
            if let Some(p) = progress {
                p(ScanProgress::Reading {
                    current: base + n,
                    total,
                });
            }
        };
        let reads = read_tracks(ctx, &wanted, &on_read);

        // 3. Apply the chunk's changes in one transaction: a commit per track
        // costs a disk sync each.
        let conn = lock(db);
        if !source_exists(&conn, source_id) {
            return Ok(summary);
        }
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        done += finished_reads.load(Ordering::Relaxed);
        for (job, read) in jobs.into_iter().zip(reads) {
            if let Some(track_id) = job.repoint {
                set_path(&tx, source_id, track_id, &job.path)?;
            }
            match job.row {
                Some(track) => {
                    if let Some(read) = read {
                        match read {
                            Ok(input) => {
                                save(&tx, &input, source_id)?;
                                summary.updated += 1;
                            }
                            Err(err) => summary.fail(&job.path, err),
                        }
                    }
                    if job.moved {
                        summary.moved += 1;
                    } else if track.missing {
                        summary.restored += 1;
                    }
                    if job.read || track.missing || track.stat != Some(job.stat) {
                        set_present(&tx, track.id, job.stat)?;
                    }
                }
                None => match read.expect("new files are read") {
                    Ok(input) => {
                        let id = save(&tx, &input, source_id)?;
                        set_present(&tx, id, job.stat)?;
                        summary.added += 1;
                    }
                    Err(err) => summary.fail(&job.path, err),
                },
            }
        }
        tx.commit().map_err(|e| e.to_string())?;
        if let Some(p) = progress {
            p(ScanProgress::Reading {
                current: done,
                total,
            });
        }
    }

    // A removed file that is gone from disk is forgotten, so a new file at
    // that path is added like any other. Only a file that is certainly absent
    // counts: one this pass didn't see because a read failed, or a folder
    // wouldn't open, is still there, and forgetting it would let it come back.
    let conn = lock(db);
    for (rel_path, key) in &removed {
        let path = sources::join_rel_path(&root, rel_path);
        if !seen_removed.contains(key)
            && coverage.contains(&path)
            && std::fs::symlink_metadata(&path)
                .is_err_and(|e| e.kind() == std::io::ErrorKind::NotFound)
        {
            db::clear_removed_track(&conn, source_id, rel_path).map_err(|e| e.to_string())?;
        }
    }
    drop(conn);

    let gone: Vec<i64> = known
        .values()
        .filter(|t| !t.missing)
        .map(|t| t.id)
        .collect();
    let conn = lock(db);
    for id in gone {
        set_missing(&conn, id, true)?;
        summary.missing += 1;
    }
    Ok(summary)
}

/// True when a part of `path` below `root` starts with a dot.
pub(crate) fn is_hidden_below(path: &Path, root: &Path) -> bool {
    path.strip_prefix(root).is_ok_and(|rel| {
        rel.components()
            .any(|c| c.as_os_str().to_string_lossy().starts_with('.'))
    })
}

/// Audio files under `dir` in the source rooted at `root`, without
/// descending into hidden folders, the Spiral folder's data (a source may
/// contain the Spiral folder) or another source nested in it. Empty when
/// `dir` is not a folder.
fn audio_files_in_source(
    dir: &Path,
    root: &Path,
    roots: &LibraryRoots,
    on_found: &mut dyn FnMut(usize),
) -> Vec<String> {
    let mut files = Vec::new();
    let mut last_report = Instant::now();
    on_found(0);
    let entries = walkdir::WalkDir::new(dir)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            !(is_hidden_below(e.path(), root)
                || e.file_type().is_dir() && sources::is_outside_source_walk(e.path(), root, roots))
        })
        .filter_map(Result::ok);
    for e in entries {
        // A symlink to a file counts, as in `file_scan`; telling needs a stat,
        // so a regular file (known from the listing) skips it.
        let is_file = e.file_type().is_file() || (e.file_type().is_symlink() && e.path().is_file());
        if is_file && is_supported_audio_file(e.path()) {
            files.push(e.path().to_string_lossy().into_owned());
        }
        // A slow (network) folder can take long to walk even when it has few
        // audio files, so report by time, not by count.
        if last_report.elapsed() >= WALK_REPORT_EVERY {
            last_report = Instant::now();
            on_found(files.len());
        }
    }
    files
}

fn read_track(ctx: &ScanContext, path: &str) -> Result<metadata_reader::ParsedTrack, String> {
    metadata_reader::read_track_metadata(path, ctx.lyrics_sidecar_enabled)
}

/// How many files are read at once. Reading is nearly all waiting on the disk
/// or network, not computing, so this is well above the core count: on a
/// network share 32 was 2.2x faster than 8 (816 files: 1.5 s against 3.3 s),
/// and a local disk loses nothing.
const READ_THREADS: usize = 32;

fn read_threads() -> usize {
    // `SPIRAL_SCAN_THREADS` is for experiments on slow (network) folders.
    std::env::var("SPIRAL_SCAN_THREADS")
        .ok()
        .and_then(|v| v.parse::<usize>().ok())
        .map_or(READ_THREADS, |n| n.clamp(1, 64))
}

/// Run `f` over `items` on a few threads, keeping their order.
fn par_map<T: Sync, R: Send>(items: &[T], f: impl Fn(&T) -> R + Sync) -> Vec<R> {
    par_map_while(items, f, || true)
}

/// Like [`par_map`], but no item is started once `go_on` is false. The items
/// started are always a prefix of `items`, and that prefix's results are
/// returned. At least one item is started when `go_on` starts out true.
fn par_map_while<T: Sync, R: Send>(
    items: &[T],
    f: impl Fn(&T) -> R + Sync,
    go_on: impl Fn() -> bool + Sync,
) -> Vec<R> {
    let next = AtomicUsize::new(0);
    let out: Vec<Mutex<Option<R>>> = items.iter().map(|_| Mutex::new(None)).collect();
    std::thread::scope(|scope| {
        for _ in 0..read_threads().min(items.len().max(1)) {
            scope.spawn(|| loop {
                if !go_on() {
                    break;
                }
                let i = next.fetch_add(1, Ordering::Relaxed);
                let Some(item) = items.get(i) else { break };
                *lock(&out[i]) = Some(f(item));
            });
        }
    });
    let started = next.into_inner().min(items.len());
    out.into_iter()
        .take(started)
        .map(|m| {
            m.into_inner()
                .unwrap_or_else(|e| e.into_inner())
                .expect("every started item was mapped")
        })
        .collect()
}

/// How many bytes of embedded pictures a scan holds, read but not yet placed,
/// before it stops reading and places them. Each read keeps its picture until
/// it's placed, and pictures can be any size, so without this a batch of files
/// with huge art could hold gigabytes. Reads already under way when the budget
/// is crossed still finish, so up to [`READ_THREADS`] pictures more can be
/// held. Ordinary art (well under 1 MB a track) never reaches it, so a batch
/// is read in one go, as before.
const ART_BUDGET: usize = 256 * 1024 * 1024;

/// Read `items` (the `Some` ones) on a few threads and `place` each result, in
/// order. Reading stops, for the results so far to be placed, whenever their
/// `held` bytes reach `budget`, then carries on with the rest.
fn read_in_rounds<T: Sync, R: Send, P>(
    items: &[Option<T>],
    read: impl Fn(&T) -> R + Sync,
    held: impl Fn(&R) -> usize + Sync,
    mut place: impl FnMut(R) -> P,
    budget: usize,
) -> Vec<Option<P>> {
    let mut placed = Vec::with_capacity(items.len());
    let mut start = 0;
    while start < items.len() {
        let pending = AtomicUsize::new(0);
        let reads = par_map_while(
            &items[start..],
            |item| {
                item.as_ref().map(|item| {
                    let result = read(item);
                    pending.fetch_add(held(&result), Ordering::Relaxed);
                    result
                })
            },
            // A zero budget still reads one item a round.
            || pending.load(Ordering::Relaxed) < budget.max(1),
        );
        start += reads.len();
        placed.extend(reads.into_iter().map(|read| read.map(&mut place)));
    }
    placed
}

/// Read `paths` (the `Some` ones) on a few threads, keeping their order, and
/// place their pictures, holding about [`ART_BUDGET`] bytes of them at most.
fn read_tracks(
    ctx: &ScanContext,
    paths: &[Option<&str>],
    on_read: &(dyn Fn() + Sync),
) -> Vec<Option<Result<crate::models::TrackInput, String>>> {
    read_in_rounds(
        paths,
        |path| {
            let read = read_track(ctx, path);
            on_read();
            read
        },
        |read| {
            read.as_ref()
                .map_or(0, metadata_reader::ParsedTrack::art_len)
        },
        |read| {
            read.map(|parsed| {
                metadata_reader::place_embedded_art(
                    &ctx.app_data_dir,
                    Some(&ctx.roots.library_root),
                    parsed,
                )
            })
        },
        ART_BUDGET,
    )
}

/// Save a track read from a source's folder and make sure it belongs to it (a
/// row already at this path in another source is claimed).
fn save(
    conn: &Connection,
    input: &crate::models::TrackInput,
    source_id: i64,
) -> Result<i64, String> {
    let id = db::save_track(conn, input, source_id).map_err(|e| e.to_string())?;
    db::set_track_source(conn, id, source_id).map_err(|e| e.to_string())?;
    lyrics_normalize::persist_import_lyrics(conn, id, &input.lyrics).map_err(|e| e.to_string())?;
    Ok(id)
}

/// Remove a user source and its tracks, cleaning up their cached and
/// library artwork the way removing a single track does. The audio files are
/// left alone. Returns how many tracks were removed.
pub fn remove_source(
    conn: &Connection,
    ctx: &ScanContext,
    source_id: i64,
) -> Result<usize, String> {
    let tracks = db::get_tracks_for_source(conn, source_id).map_err(|e| e.to_string())?;
    let removed = sources::remove_source(conn, source_id)?;
    for track in &tracks {
        let _ = art_cache::remove_cached_art(&ctx.app_data_dir, &track.file_path);
        if let Err(err) =
            artwork_organize::gc_art_after_track_removed(conn, &ctx.roots.library_root, track)
        {
            eprintln!("artwork GC after removing source {source_id}: {err}");
        }
    }
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db_migrations;
    use crate::test_fixtures::wav;
    use std::fs;

    struct Fixture {
        dir: PathBuf,
        db: Mutex<Connection>,
        ctx: ScanContext,
    }

    impl Fixture {
        fn new(label: &str) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "spiral-source-scan-{label}-{}-{}",
                std::process::id(),
                Utc::now().timestamp_nanos_opt().unwrap_or_default()
            ));
            let library = dir.join("Music/Spiral Library");
            fs::create_dir_all(library.join("Tracks")).unwrap();
            let conn = Connection::open_in_memory().unwrap();
            conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
            sources::attach_spiral_folder(&conn, &library).unwrap();
            db_migrations::run(&conn, None).unwrap();
            Self {
                db: Mutex::new(conn),
                ctx: ScanContext {
                    app_data_dir: dir.join("AppData"),
                    roots: LibraryRoots::for_library_root(&library),
                    lyrics_sidecar_enabled: false,
                },
                dir,
            }
        }

        fn path(&self, rel: &str) -> PathBuf {
            self.dir.join(rel)
        }

        /// Write a small valid WAV at `rel`, creating its folders.
        fn wav(&self, rel: &str) -> PathBuf {
            let path = self.path(rel);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            wav::write_minimal(&path);
            path
        }

        fn watch(&self, rel: &str) -> i64 {
            let root = self.path(rel);
            fs::create_dir_all(&root).unwrap();
            sources::add_source(
                &lock(&self.db),
                &self.ctx.roots,
                &root.to_string_lossy(),
                None,
            )
            .unwrap()
            .id
        }

        /// The Spiral folder's `Tracks` as a source, created on first use.
        fn managed(&self) -> i64 {
            sources::create_managed_source(&lock(&self.db), &self.ctx.roots)
                .unwrap()
                .id
        }

        fn reconcile(&self, source_id: i64) -> ReconcileSummary {
            reconcile_source(&self.db, &self.ctx, source_id, ReconcileScope::All).unwrap()
        }

        fn reconcile_paths(&self, source_id: i64, paths: &[PathBuf]) -> ReconcileSummary {
            reconcile_source(&self.db, &self.ctx, source_id, ReconcileScope::Paths(paths)).unwrap()
        }

        /// `(file_path, title, missing)` for a source's tracks, by path.
        fn tracks(&self, source_id: i64) -> Vec<(String, String, bool)> {
            let mut tracks: Vec<_> = db::get_tracks_for_source(&lock(&self.db), source_id)
                .unwrap()
                .into_iter()
                .map(|t| (t.file_path, t.title, t.missing_since.is_some()))
                .collect();
            tracks.sort();
            tracks
        }

        /// Give a track a play count and a playlist entry.
        fn listen_and_list(&self, track: i64) {
            let conn = lock(&self.db);
            conn.execute(
                "UPDATE tracks SET play_count = 3 WHERE id = ?1",
                params![track],
            )
            .unwrap();
            conn.execute_batch(&format!(
                "INSERT INTO playlists (title, date_created, last_used_at)
                 VALUES ('Mix', '2026-01-01', '2026-01-01');
                 INSERT INTO playlist_tracks (playlist_id, track_id, position)
                 VALUES (last_insert_rowid(), {track}, 0);"
            ))
            .unwrap();
        }

        /// A track's play count and how many playlist entries it has.
        fn listens_and_lists(&self, track: i64) -> (i64, i64) {
            lock(&self.db)
                .query_row(
                    "SELECT play_count,
                       (SELECT COUNT(*) FROM playlist_tracks WHERE track_id = tracks.id)
                     FROM tracks WHERE id = ?1",
                    params![track],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .unwrap()
        }

        fn set_mtime(&self, path: &Path, secs: u64) {
            fs::File::options()
                .write(true)
                .open(path)
                .unwrap()
                .set_modified(UNIX_EPOCH + std::time::Duration::from_secs(secs))
                .unwrap();
        }

        fn track_id(&self, path: &Path) -> i64 {
            db::track_id_for_path(&lock(&self.db), &path.to_string_lossy())
                .unwrap()
                .unwrap()
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.dir);
        }
    }

    fn s(path: &Path) -> String {
        path.to_string_lossy().into_owned()
    }

    fn summary(
        source_id: i64,
        added: u32,
        updated: u32,
        missing: u32,
        restored: u32,
    ) -> ReconcileSummary {
        ReconcileSummary {
            source_id,
            added,
            updated,
            missing,
            restored,
            ..ReconcileSummary::default()
        }
    }

    fn moved(source_id: i64, moved: u32) -> ReconcileSummary {
        ReconcileSummary {
            moved,
            ..summary(source_id, 0, 0, 0, 0)
        }
    }

    /// Timing for a real folder: `SPIRAL_BENCH_DIR=~/Music cargo test --release
    /// --lib bench_scan -- --ignored --nocapture`. Read-only on that folder.
    #[test]
    #[ignore]
    fn bench_scan() {
        use std::time::Instant;
        let Ok(dir) = std::env::var("SPIRAL_BENCH_DIR") else {
            return;
        };
        let fx = Fixture::new("bench");
        let reconcile_only = std::env::var("SPIRAL_BENCH_RECONCILE_ONLY").is_ok();
        // A database file, not memory: commits cost a disk sync there.
        {
            let library = fx.dir.join("Music/Spiral Library");
            let conn = Connection::open(library.join("Library.db")).unwrap();
            conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
            sources::attach_spiral_folder(&conn, &library).unwrap();
            db_migrations::run(&conn, None).unwrap();
            *lock(&fx.db) = conn;
        }
        let root = PathBuf::from(&dir);
        let files = {
            let roots = fx.ctx.roots.clone();
            audio_files_in_source(&root, &root, &roots, &mut |_| {})
        };
        println!("{} audio files in {dir}", files.len());

        if !reconcile_only {
            let t = Instant::now();
            let _ = audio_files_in_source(&root, &root, &fx.ctx.roots, &mut |_| {});
            println!("walk (list files):  {:?}", t.elapsed());

            let t = Instant::now();
            for f in &files {
                let _ = file_stat(Path::new(f));
            }
            println!("stat, serial:       {:?}", t.elapsed());
            let t = Instant::now();
            let _ = par_map(&files, |f| file_stat(Path::new(f)));
            println!("stat, parallel:     {:?}", t.elapsed());

            let t = Instant::now();
            for f in &files {
                let _ = metadata_reader::read_basic_tags(Path::new(f));
            }
            println!("tags only:          {:?}", t.elapsed());

            let t = Instant::now();
            for f in &files {
                let _ = crate::audio_properties::header_properties_for_bench(Path::new(f));
            }
            println!("  headers only:     {:?}", t.elapsed());

            let t = Instant::now();
            for f in &files {
                let _ = crate::audio_properties::read_audio_properties(Path::new(f));
            }
            println!(
                "audio properties (headers + average bitrate): {:?}",
                t.elapsed()
            );

            let t = Instant::now();
            for f in &files {
                let _ = metadata_reader::parse_track_metadata_for_library(
                    &fx.ctx.app_data_dir,
                    f,
                    false,
                    Some(&fx.ctx.roots.library_root),
                );
            }
            println!("parse (incl. art):  {:?}", t.elapsed());
        }
        let id = sources::add_source(&lock(&fx.db), &fx.ctx.roots, &dir, None)
            .unwrap()
            .id;
        let t = Instant::now();
        let summary = fx.reconcile(id);
        println!(
            "full reconcile:     {:?} ({} added)",
            t.elapsed(),
            summary.added
        );
        let t = Instant::now();
        fx.reconcile(id);
        println!("second pass (no-op): {:?}", t.elapsed());
    }

    /// Reads `items` as `read_in_rounds` would for a scan, each holding
    /// `weight` bytes. Returns what was placed, the most bytes held unplaced
    /// at once, and how many rounds it took.
    fn rounds(
        items: &[Option<usize>],
        weight: usize,
        budget: usize,
    ) -> (Vec<Option<usize>>, usize, usize) {
        let held = AtomicUsize::new(0);
        let most = AtomicUsize::new(0);
        let reads_since_place = AtomicUsize::new(0);
        let mut rounds = 0;
        let placed = read_in_rounds(
            items,
            |&i| {
                let now = held.fetch_add(weight, Ordering::SeqCst) + weight;
                most.fetch_max(now, Ordering::SeqCst);
                reads_since_place.fetch_add(1, Ordering::SeqCst);
                i
            },
            |_| weight,
            |i| {
                // The first place after some reads starts a new round.
                if reads_since_place.swap(0, Ordering::SeqCst) > 0 {
                    rounds += 1;
                }
                held.fetch_sub(weight, Ordering::SeqCst);
                i
            },
            budget,
        );
        (placed, most.into_inner(), rounds)
    }

    #[test]
    fn reading_stops_to_place_art_once_the_budget_is_crossed() {
        let items: Vec<Option<usize>> = (0..WRITE_BATCH)
            .map(|i| (i % 7 != 3).then_some(i))
            .collect();
        let weight = 10;
        let budget = 25;
        let (placed, most, rounds) = rounds(&items, weight, budget);

        // Everything is read and placed, in order, none dropped.
        assert_eq!(placed, items);
        // Art was placed before the whole batch was read...
        assert!(rounds > 1, "read in {rounds} round(s)");
        let all = items.iter().flatten().count() * weight;
        assert!(most < all, "held {most} of {all} bytes at once");
        // ...holding at most the budget plus the reads already under way.
        assert!(most <= budget + read_threads() * weight, "held {most}");
    }

    #[test]
    fn small_art_reads_a_batch_in_one_go() {
        let items: Vec<Option<usize>> = (0..WRITE_BATCH).map(Some).collect();
        let (placed, most, rounds) = rounds(&items, 10, ART_BUDGET);
        assert_eq!(placed, items);
        assert_eq!(rounds, 1);
        assert_eq!(most, WRITE_BATCH * 10);
    }

    #[test]
    fn a_zero_budget_still_reads_everything() {
        let items: Vec<Option<usize>> = (0..10).map(Some).collect();
        let (placed, _, _) = rounds(&items, 10, 0);
        assert_eq!(placed, items);
    }

    #[test]
    fn scans_more_files_than_one_batch() {
        let fx = Fixture::new("batches");
        let id = fx.watch("Collection");
        let count = WRITE_BATCH * 2 + 7;
        for i in 0..count {
            fx.wav(&format!("Collection/Album/{i:04}.wav"));
        }

        assert_eq!(fx.reconcile(id), summary(id, count as u32, 0, 0, 0));
        assert_eq!(fx.tracks(id).len(), count);
        // Nothing changed, so nothing is read or written again.
        assert_eq!(fx.reconcile(id), summary(id, 0, 0, 0, 0));
    }

    #[test]
    fn reports_each_file_it_reads_with_the_total() {
        let fx = Fixture::new("progress");
        let id = fx.watch("Collection");
        fx.wav("Collection/a.wav");
        fx.wav("Collection/Artist/b.wav");
        fs::write(fx.path("Collection/notes.txt"), b"hi").unwrap();

        let seen = Mutex::new(Vec::new());
        let report = |p: ScanProgress| lock(&seen).push(p);
        reconcile_source_with_progress(&fx.db, &fx.ctx, id, ReconcileScope::All, Some(&report))
            .unwrap();
        let seen = seen.into_inner().unwrap();

        // The walk reports before the reads do.
        assert_eq!(seen.first(), Some(&ScanProgress::Walking { found: 0 }));
        let mut reading: Vec<_> = seen
            .into_iter()
            .filter_map(|p| match p {
                ScanProgress::Reading { current, total } => Some((current, total)),
                ScanProgress::Walking { .. } => None,
            })
            .collect();
        // Reads finish in any order, so check what was counted, not when.
        reading.sort();
        reading.dedup();
        assert_eq!(reading, vec![(1, 2), (2, 2)]);
        assert_eq!(reading.last(), Some(&(2, 2)));
    }

    #[test]
    fn adds_nested_audio_files_and_ignores_the_rest() {
        let fx = Fixture::new("add");
        let id = fx.watch("Collection");
        let a = fx.wav("Collection/a.wav");
        let b = fx.wav("Collection/Artist/Album/Disc 1/b.wav");
        fs::write(fx.path("Collection/notes.txt"), b"hi").unwrap();
        fs::write(fx.path("Collection/Artist/cover.jpg"), b"jpg").unwrap();
        fs::write(
            fx.path("Collection/Artist/Album/Disc 1/b.lrc"),
            b"[00:01]la",
        )
        .unwrap();

        assert_eq!(fx.reconcile(id), summary(id, 2, 0, 0, 0));
        assert_eq!(
            fx.tracks(id),
            vec![(s(&b), "b".into(), false), (s(&a), "a".into(), false),]
        );
        // Files stay where they are.
        assert!(a.is_file() && b.is_file());
    }

    #[test]
    fn repeated_reconcile_is_a_no_op() {
        let fx = Fixture::new("repeat");
        let id = fx.watch("Collection");
        fx.wav("Collection/a.wav");
        fx.wav("Collection/Sub/b.wav");
        fx.reconcile(id);
        let before = db::get_tracks_for_source(&lock(&fx.db), id).unwrap();

        assert_eq!(fx.reconcile(id), summary(id, 0, 0, 0, 0));
        assert!(!fx.reconcile(id).changed());
        let after = db::get_tracks_for_source(&lock(&fx.db), id).unwrap();
        assert_eq!(
            before
                .iter()
                .map(|t| (t.id, &t.file_path, &t.title))
                .collect::<Vec<_>>(),
            after
                .iter()
                .map(|t| (t.id, &t.file_path, &t.title))
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn changed_files_are_read_again() {
        let fx = Fixture::new("changed");
        let id = fx.watch("Collection");
        let a = fx.wav("Collection/a.wav");
        fx.wav("Collection/b.wav");
        fx.reconcile(id);
        let a_id = fx.track_id(&a);
        // Rate it, so we can check the row is updated rather than replaced.
        db::set_track_rating(&lock(&fx.db), a_id, 4).unwrap();

        fs::copy(wav::tagged_fixture_path(), &a).unwrap();
        assert_eq!(fx.reconcile(id), summary(id, 0, 1, 0, 0));
        let track = db::get_track_by_id(&lock(&fx.db), a_id).unwrap().unwrap();
        assert_eq!(track.title, "WAV Title");
        assert_eq!(track.rating, 4);
        assert_eq!(fx.reconcile(id), summary(id, 0, 0, 0, 0));
    }

    #[test]
    fn missing_files_are_marked_and_cleared_when_they_return() {
        let fx = Fixture::new("missing");
        let id = fx.watch("Collection");
        let a = fx.wav("Collection/Sub/a.wav");
        fx.wav("Collection/b.wav");
        fx.reconcile(id);
        let a_id = fx.track_id(&a);

        fs::remove_file(&a).unwrap();
        assert_eq!(fx.reconcile(id), summary(id, 0, 0, 1, 0));
        let track = db::get_track_by_id(&lock(&fx.db), a_id).unwrap().unwrap();
        assert!(track.missing_since.is_some());
        assert_eq!(fx.tracks(id).len(), 2, "rows are never deleted");
        assert_eq!(fx.reconcile(id), summary(id, 0, 0, 0, 0));

        // Back with different content, so it is read again as well as restored.
        // (An identical rewrite can match the stored size and mtime: no change.)
        fs::copy(wav::tagged_fixture_path(), &a).unwrap();
        assert_eq!(fx.reconcile(id), summary(id, 0, 1, 0, 1));
        let track = db::get_track_by_id(&lock(&fx.db), a_id).unwrap().unwrap();
        assert_eq!(track.missing_since, None);
    }

    /// An unplugged drive's folder is offline, not empty: its tracks aren't
    /// marked missing, and nothing changes when it's back.
    #[test]
    fn an_unreachable_root_fails_and_keeps_its_tracks() {
        let fx = Fixture::new("unplugged");
        let id = fx.watch("Drive/Music");
        let a = fx.wav("Drive/Music/a.wav");
        let b = fx.wav("Drive/Music/b.wav");
        fx.reconcile(id);
        fs::rename(fx.path("Drive"), fx.path("Unplugged")).unwrap();
        let err = reconcile_source(&fx.db, &fx.ctx, id, ReconcileScope::All).unwrap_err();
        assert!(err.starts_with(sources::SOURCE_UNAVAILABLE), "{err}");
        assert_eq!(
            fx.tracks(id),
            vec![(s(&a), "a".into(), false), (s(&b), "b".into(), false)]
        );
        fs::rename(fx.path("Unplugged"), fx.path("Drive")).unwrap();
        assert_eq!(fx.reconcile(id), summary(id, 0, 0, 0, 0));
    }

    /// A share whose connection dropped stalls instead of failing. The pass
    /// reports it at once, without walking it, and leaves the rows alone (it may
    /// be back in a moment), so a later pass restores nothing it didn't change.
    #[test]
    fn a_stalled_root_fails_fast_and_keeps_its_tracks() {
        let fx = Fixture::new("stalled");
        let id = fx.watch("Share/Music");
        let a = fx.wav("Share/Music/a.wav");
        fx.reconcile(id);

        let stall = fs_probe::stall_dir(&fx.path("Share/Music"));
        let started = Instant::now();
        for scope in [
            ReconcileScope::All,
            ReconcileScope::Paths(std::slice::from_ref(&a)),
        ] {
            let err = reconcile_source(&fx.db, &fx.ctx, id, scope).unwrap_err();
            assert!(err.starts_with(sources::SOURCE_UNAVAILABLE), "{err}");
        }
        assert!(started.elapsed() < Duration::from_millis(500));
        assert_eq!(fx.tracks(id), vec![(s(&a), "a".into(), false)]);

        // The share is back: scanning works again.
        drop(stall);
        assert_eq!(fx.reconcile(id), summary(id, 0, 0, 0, 0));
    }

    #[test]
    fn watched_sources_reconcile_independently() {
        let fx = Fixture::new("two");
        let rock = fx.watch("Rock");
        let jazz = fx.watch("Jazz");
        let r = fx.wav("Rock/r.wav");
        let j = fx.wav("Jazz/j.wav");

        assert_eq!(fx.reconcile(rock), summary(rock, 1, 0, 0, 0));
        assert_eq!(fx.tracks(rock), vec![(s(&r), "r".into(), false)]);
        assert!(fx.tracks(jazz).is_empty());

        assert_eq!(fx.reconcile(jazz), summary(jazz, 1, 0, 0, 0));
        fs::remove_file(&j).unwrap();
        assert_eq!(fx.reconcile(rock), summary(rock, 0, 0, 0, 0));
        assert_eq!(fx.tracks(jazz), vec![(s(&j), "j".into(), false)]);
        assert_eq!(fx.reconcile(jazz), summary(jazz, 0, 0, 1, 0));
        assert_eq!(fx.tracks(rock), vec![(s(&r), "r".into(), false)]);
    }

    #[test]
    fn reconciling_paths_touches_only_those_paths() {
        let fx = Fixture::new("paths");
        let id = fx.watch("Collection");
        let a = fx.wav("Collection/a.wav");
        let b = fx.wav("Collection/Sub/b.wav");
        fx.reconcile(id);

        let c = fx.wav("Collection/Sub/c.wav");
        let d = fx.wav("Collection/d.wav");
        fs::remove_file(&a).unwrap();
        fs::remove_file(&b).unwrap();
        let outside = fx.wav("Elsewhere/e.wav");

        // A deleted file and a folder; `d` is not mentioned, `e` is outside.
        let changed = [a.clone(), fx.path("Collection/Sub"), outside];
        assert_eq!(fx.reconcile_paths(id, &changed), summary(id, 1, 0, 2, 0));
        assert_eq!(
            fx.tracks(id),
            vec![
                (s(&b), "b".into(), true),
                (s(&c), "c".into(), false),
                (s(&a), "a".into(), true),
            ]
        );
        assert_eq!(fx.reconcile(id), summary(id, 1, 0, 0, 0));
        assert!(fx.tracks(id).iter().any(|(p, _, _)| *p == s(&d)));
    }

    #[test]
    fn a_folder_renamed_within_the_source_moves_its_tracks() {
        let fx = Fixture::new("rename-dir");
        let id = fx.watch("Collection");
        let old = fx.wav("Collection/Old/a.wav");
        fx.reconcile(id);

        // A watcher reports only the folder's two names, not the files in it.
        fs::rename(fx.path("Collection/Old"), fx.path("Collection/New")).unwrap();
        let new = fx.path("Collection/New/a.wav");
        let changed = [fx.path("Collection/Old"), fx.path("Collection/New")];
        let track = fx.track_id(&old);
        assert_eq!(fx.reconcile_paths(id, &changed), moved(id, 1));
        assert_eq!(fx.tracks(id), vec![(s(&new), "a".into(), false)]);
        assert_eq!(fx.track_id(&new), track);
    }

    #[test]
    fn a_moved_file_keeps_its_row() {
        let fx = Fixture::new("move");
        let id = fx.watch("Collection");
        let old = fx.wav("Collection/a.wav");
        fx.reconcile(id);
        let track = fx.track_id(&old);
        fx.listen_and_list(track);

        let new = fx.path("Collection/Sorted/renamed.wav");
        fs::create_dir_all(new.parent().unwrap()).unwrap();
        fs::rename(&old, &new).unwrap();

        assert_eq!(fx.reconcile(id), moved(id, 1));
        assert_eq!(fx.tracks(id), vec![(s(&new), "a".into(), false)]);
        assert_eq!(fx.track_id(&new), track);
        assert_eq!(fx.listens_and_lists(track), (3, 1));
        assert_eq!(fx.reconcile(id), summary(id, 0, 0, 0, 0));
    }

    #[test]
    fn moving_a_file_and_back_leaves_no_ghost() {
        let fx = Fixture::new("move-back");
        let id = fx.watch("Collection");
        let home = fx.wav("Collection/a.wav");
        let away = fx.path("Collection/b.wav");
        fx.reconcile(id);
        let track = fx.track_id(&home);
        fx.listen_and_list(track);

        fs::rename(&home, &away).unwrap();
        assert_eq!(fx.reconcile(id), moved(id, 1));
        fs::rename(&away, &home).unwrap();
        assert_eq!(fx.reconcile(id), moved(id, 1));

        assert_eq!(fx.tracks(id), vec![(s(&home), "a".into(), false)]);
        assert_eq!(fx.track_id(&home), track);
        assert_eq!(fx.listens_and_lists(track), (3, 1));
    }

    #[test]
    fn a_move_seen_as_separate_delete_and_create_keeps_its_row() {
        let fx = Fixture::new("move-split");
        let id = fx.watch("Collection");
        let old = fx.wav("Collection/Old/a.wav");
        fx.reconcile(id);
        let track = fx.track_id(&old);
        let new = fx.path("Collection/New/a.wav");
        fs::create_dir_all(new.parent().unwrap()).unwrap();
        fs::rename(&old, &new).unwrap();

        // The delete arrives first and marks the row missing, then the create
        // reports a path that doesn't cover the row.
        assert_eq!(
            fx.reconcile_paths(id, std::slice::from_ref(&old)),
            summary(id, 0, 0, 1, 0)
        );
        assert_eq!(fx.tracks(id), vec![(s(&old), "a".into(), true)]);
        assert_eq!(
            fx.reconcile_paths(id, std::slice::from_ref(&new)),
            moved(id, 1)
        );
        assert_eq!(fx.tracks(id), vec![(s(&new), "a".into(), false)]);
        assert_eq!(fx.track_id(&new), track);
    }

    #[test]
    fn a_create_seen_before_its_delete_keeps_its_row() {
        let fx = Fixture::new("move-create-first");
        let id = fx.watch("Collection");
        let old = fx.wav("Collection/Old/a.wav");
        fx.reconcile(id);
        let new = fx.path("Collection/New/a.wav");
        fs::create_dir_all(new.parent().unwrap()).unwrap();
        fs::rename(&old, &new).unwrap();

        assert_eq!(
            fx.reconcile_paths(id, std::slice::from_ref(&new)),
            moved(id, 1)
        );
        assert_eq!(
            fx.reconcile_paths(id, std::slice::from_ref(&old)),
            summary(id, 0, 0, 0, 0)
        );
        assert_eq!(fx.tracks(id), vec![(s(&new), "a".into(), false)]);
    }

    #[test]
    fn two_gone_rows_with_the_same_stat_are_not_guessed_between() {
        let fx = Fixture::new("move-ambiguous");
        let id = fx.watch("Collection");
        let a = fx.wav("Collection/a.wav");
        let b = fx.wav("Collection/b.wav");
        fx.set_mtime(&a, 1_700_000_000);
        fx.set_mtime(&b, 1_700_000_000);
        fx.reconcile(id);

        let c = fx.path("Collection/c.wav");
        fs::rename(&a, &c).unwrap();
        fs::remove_file(&b).unwrap();

        assert_eq!(fx.reconcile(id), summary(id, 1, 0, 2, 0));
        assert_eq!(
            fx.tracks(id),
            vec![
                (s(&a), "a".into(), true),
                (s(&b), "b".into(), true),
                (s(&c), "c".into(), false),
            ]
        );
    }

    #[test]
    fn a_row_whose_file_is_still_there_is_not_moved() {
        let fx = Fixture::new("move-copy");
        let id = fx.watch("Collection");
        let a = fx.wav("Collection/a.wav");
        fx.set_mtime(&a, 1_700_000_000);
        fx.reconcile(id);

        let copy = fx.path("Collection/copy.wav");
        fs::copy(&a, &copy).unwrap();
        fx.set_mtime(&copy, 1_700_000_000);

        assert_eq!(fx.reconcile(id), summary(id, 1, 0, 0, 0));
        assert_eq!(
            fx.tracks(id),
            vec![(s(&a), "a".into(), false), (s(&copy), "copy".into(), false)]
        );
    }

    #[test]
    fn a_row_without_a_stat_is_not_moved() {
        let fx = Fixture::new("move-no-stat");
        let id = fx.watch("Collection");
        let old = fx.wav("Collection/a.wav");
        fx.reconcile(id);
        lock(&fx.db)
            .execute(
                "UPDATE tracks SET file_size = NULL, file_mtime_ms = NULL",
                [],
            )
            .unwrap();

        let new = fx.path("Collection/b.wav");
        fs::rename(&old, &new).unwrap();

        assert_eq!(fx.reconcile(id), summary(id, 1, 0, 1, 0));
        assert_eq!(
            fx.tracks(id),
            vec![(s(&old), "a".into(), true), (s(&new), "b".into(), false)]
        );
    }

    #[test]
    fn a_file_moved_between_sources_is_a_new_row() {
        let fx = Fixture::new("move-sources");
        let from = fx.watch("Collection");
        let to = fx.watch("Other");
        let old = fx.wav("Collection/a.wav");
        fx.reconcile(from);

        let new = fx.path("Other/a.wav");
        fs::rename(&old, &new).unwrap();

        assert_eq!(fx.reconcile(to), summary(to, 1, 0, 0, 0));
        assert_eq!(fx.reconcile(from), summary(from, 0, 0, 1, 0));
    }

    #[test]
    fn a_source_in_the_spiral_folder_is_walked() {
        let fx = Fixture::new("default");
        let tracks = fx.managed();
        let managed = fx.wav("Music/Spiral Library/Tracks/a.wav");
        let input = crate::models::TrackInput {
            title: "Song".into(),
            file_path: s(&managed),
            ..Default::default()
        };
        db::save_track(&lock(&fx.db), &input, tracks).unwrap();
        // Dropped into the tracks folder in Finder.
        let dropped = fx.wav("Music/Spiral Library/Tracks/Artist/dropped.wav");
        // Never walked: hidden folders (convert scratch) and the rest of the
        // Spiral folder.
        fx.wav("Music/Spiral Library/Tracks/.spiral-convert/1.wav");
        fx.wav("Music/Spiral Library/Tracks/._a.wav");
        fx.wav("Music/Spiral Library/Packs/sounds/pack/click.wav");
        // Nor is anything outside every source.
        fx.wav("Downloads/c.wav");

        assert_eq!(fx.reconcile(tracks), summary(tracks, 1, 0, 0, 0));
        assert_eq!(
            fx.tracks(tracks),
            vec![
                (s(&dropped), "dropped".into(), false),
                (s(&managed), "Song".into(), false),
            ]
        );
        fs::remove_file(&managed).unwrap();
        let all = reconcile_all(&fx.db, &fx.ctx);
        assert_eq!(all, vec![summary(tracks, 0, 0, 1, 0)]);

        // Back with different content, so it is read again as well as restored.
        fs::copy(wav::tagged_fixture_path(), &managed).unwrap();
        assert_eq!(fx.reconcile(tracks), summary(tracks, 0, 1, 0, 1));

        // A watcher batch inside the tracks folder is reconciled; hidden
        // paths in it are ignored.
        let later = fx.wav("Music/Spiral Library/Tracks/later.wav");
        let hidden = fx.wav("Music/Spiral Library/Tracks/.spiral-convert/2.wav");
        assert_eq!(
            fx.reconcile_paths(tracks, &[later.clone(), hidden]),
            summary(tracks, 1, 0, 0, 0)
        );
        assert_eq!(fx.tracks(tracks).len(), 3);
    }

    #[test]
    fn a_source_around_the_spiral_folder_skips_its_data_and_tracks_source() {
        let fx = Fixture::new("around");
        let tracks = fx.managed();
        let managed = fx.wav("Music/Spiral Library/Tracks/Artist/Album/m.wav");
        let input = crate::models::TrackInput {
            title: "Managed".into(),
            file_path: s(&managed),
            ..Default::default()
        };
        let managed_id = db::save_track(&lock(&fx.db), &input, tracks).unwrap();
        // Untracked files in the tracks folder and a sound pack's audio.
        fx.wav("Music/Spiral Library/Tracks/Artist/Album/stray.wav");
        fx.wav("Music/Spiral Library/Packs/sounds/pack/click.wav");
        let loose = fx.wav("Music/SomeArtist/loose.wav");
        let top = fx.wav("Music/top.wav");

        // Sources can't overlap any more, but a library from before `Tracks`
        // was an ordinary source may have one around the Spiral folder.
        let music = {
            let conn = lock(&fx.db);
            conn.execute(
                "INSERT INTO sources (name, root_path, created_at) VALUES ('Music', ?1, 'now')",
                params![s(&fx.path("Music"))],
            )
            .unwrap();
            conn.last_insert_rowid()
        };
        assert_eq!(fx.reconcile(music), summary(music, 2, 0, 0, 0));
        assert_eq!(
            fx.tracks(music),
            vec![
                (s(&loose), "loose".into(), false),
                (s(&top), "top".into(), false),
            ]
        );
        assert_eq!(
            fx.tracks(tracks),
            vec![(s(&managed), "Managed".into(), false)]
        );
        let total: i64 = lock(&fx.db)
            .query_row("SELECT COUNT(*) FROM tracks", [], |r| r.get(0))
            .unwrap();
        assert_eq!(total, 3);
        assert_eq!(fx.reconcile(music), summary(music, 0, 0, 0, 0));

        // Paths inside the library are ignored, and a watched pass never marks
        // managed tracks missing.
        fs::remove_file(&managed).unwrap();
        let inside = [
            managed.clone(),
            fx.path("Music/Spiral Library"),
            fx.path("Music/Spiral Library/Packs/sounds/pack/click.wav"),
        ];
        assert_eq!(
            fx.reconcile_paths(music, &inside),
            summary(music, 0, 0, 0, 0)
        );
        assert_eq!(
            fx.reconcile_paths(music, &[fx.path("Music")]),
            summary(music, 0, 0, 0, 0)
        );
        let track = db::get_track_by_id(&lock(&fx.db), managed_id)
            .unwrap()
            .unwrap();
        assert_eq!((track.source_id, track.missing_since), (tracks, None));
        // `Tracks`'s own pass marks it, and picks up the stray file the
        // source around it skipped.
        assert_eq!(fx.reconcile(tracks), summary(tracks, 1, 0, 1, 0));
    }

    #[test]
    fn removing_a_source_cleans_art_and_keeps_files() {
        let fx = Fixture::new("remove");
        let id = fx.watch("Collection");
        let keep = fx.watch("Keep");
        let a = fx.wav("Collection/a.wav");
        let k = fx.wav("Keep/k.wav");
        fx.reconcile(id);
        fx.reconcile(keep);
        let a_id = fx.track_id(&a);
        let cache =
            art_cache::write_bytes_to_art_cache(&fx.ctx.app_data_dir, &s(&a), b"art", "jpg")
                .unwrap();
        let album_dir = crate::artwork_paths::album_artwork_dir(
            &fx.ctx.roots.library_root,
            None,
            Some("Artist"),
            Some("Album"),
        );
        fs::create_dir_all(&album_dir).unwrap();
        fs::write(album_dir.join("front.jpg"), b"art").unwrap();
        lock(&fx.db)
            .execute(
                "UPDATE tracks SET artist = 'Artist', album = 'Album' WHERE id = ?1",
                params![a_id],
            )
            .unwrap();

        let removed = remove_source(&lock(&fx.db), &fx.ctx, id).unwrap();
        assert_eq!(removed, 1);
        assert!(sources::get_source(&lock(&fx.db), id).unwrap().is_none());
        assert!(!cache.exists());
        assert!(!album_dir.exists());
        assert!(a.is_file(), "audio files are left alone");
        assert_eq!(fx.tracks(keep), vec![(s(&k), "k".into(), false)]);
        // A reconcile of the removed source fails instead of recreating it.
        assert!(reconcile_source(&fx.db, &fx.ctx, id, ReconcileScope::All).is_err());
    }

    #[test]
    fn removed_file_is_not_added_back_until_restored() {
        let fx = Fixture::new("removed-skip");
        let id = fx.watch("Music/Folder");
        let song = fx.wav("Music/Folder/Sub/Song.wav");
        fx.wav("Music/Folder/Other.wav");
        fx.reconcile(id);
        let track = fx.track_id(&song);

        assert!(db::delete_track_keep_excluded(&lock(&fx.db), track)
            .unwrap()
            .is_some());
        let summary = fx.reconcile(id);
        assert_eq!(summary.added, 0);
        assert_eq!(fx.tracks(id).len(), 1);
        // Also by a watcher-style pass over just that file.
        assert_eq!(fx.reconcile_paths(id, &[song.clone()]).added, 0);
        assert_eq!(fx.tracks(id).len(), 1);

        db::clear_removed_track(&lock(&fx.db), id, "Sub/Song.wav").unwrap();
        assert_eq!(fx.reconcile(id).added, 1);
        assert_eq!(fx.tracks(id).len(), 2);
    }

    #[test]
    fn removed_file_is_forgotten_once_it_is_gone_from_disk() {
        let fx = Fixture::new("removed-gone");
        let id = fx.watch("Music/Folder");
        let song = fx.wav("Music/Folder/Song.wav");
        fx.reconcile(id);
        let track = fx.track_id(&song);
        db::delete_track_keep_excluded(&lock(&fx.db), track).unwrap();

        fs::remove_file(&song).unwrap();
        fx.reconcile(id);
        assert!(db::removed_tracks(&lock(&fx.db), id).unwrap().is_empty());

        // A new file at that path is added like any other.
        fx.wav("Music/Folder/Song.wav");
        assert_eq!(fx.reconcile(id).added, 1);
    }

    #[test]
    fn removing_a_source_forgets_its_removed_files() {
        let fx = Fixture::new("removed-cascade");
        let id = fx.watch("Music/Folder");
        fx.watch("Music/Keep");
        let song = fx.wav("Music/Folder/Song.wav");
        fx.reconcile(id);
        let track = fx.track_id(&song);
        db::delete_track_keep_excluded(&lock(&fx.db), track).unwrap();
        assert_eq!(db::removed_tracks(&lock(&fx.db), id).unwrap().len(), 1);

        sources::remove_source(&lock(&fx.db), id).unwrap();
        let left: i64 = lock(&fx.db)
            .query_row("SELECT COUNT(*) FROM removed_tracks", [], |r| r.get(0))
            .unwrap();
        assert_eq!(left, 0);
    }

    #[test]
    fn removed_file_is_kept_when_a_scan_did_not_see_it_but_it_is_still_there() {
        let fx = Fixture::new("removed-unseen");
        let id = fx.watch("Music/Folder");
        fx.wav("Music/Folder/Other.wav");
        // Never walked (hidden folder), but on disk and within the scan.
        fx.wav("Music/Folder/.hidden/Song.wav");
        lock(&fx.db)
            .execute(
                "INSERT INTO removed_tracks (source_id, rel_path, path_key, removed_at)
                 VALUES (?1, '.hidden/Song.wav', '.hidden/song.wav', 'now')",
                params![id],
            )
            .unwrap();
        fx.reconcile(id);
        assert_eq!(db::removed_tracks(&lock(&fx.db), id).unwrap().len(), 1);
    }
}
