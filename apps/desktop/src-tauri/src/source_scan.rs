//! Keeping each source's tracks in step with the files on disk.
//!
//! Reconciling a source walks its folder: new audio files become tracks of
//! that source (read in place, never moved), files whose size or modification
//! time changed since they were last read are read again, and tracks whose
//! file is gone get `missing_since`. A track is never deleted here; when its
//! file comes back the mark is cleared. Every source with a folder is walked,
//! the default source included. Other has no folder, so its tracks only get
//! the missing marks. Hidden files and folders (e.g. `.spiral-convert`) are
//! skipped.
//!
//! Reconciling is idempotent and serialized, so the startup pass, a manual
//! rescan and the file watcher can all call it. Files are read without holding
//! the database lock, and the lock is taken briefly for each write.

use crate::art_cache;
use crate::artwork_organize;
use crate::audio_formats::is_supported_audio_file;
use crate::db;
use crate::library_organize;
use crate::lyrics_normalize;
use crate::metadata_reader;
use crate::sources::{self, LibraryRoots, Source, SourceRoots};
use chrono::Utc;
use rusqlite::{params, Connection};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;

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
        self.added + self.updated + self.missing + self.restored > 0
    }

    fn fail(&mut self, path: &str, err: impl std::fmt::Display) {
        self.failed += 1;
        if self.errors.len() < MAX_ERRORS {
            self.errors.push(format!("{path}: {err}"));
        }
    }
}

const MAX_ERRORS: usize = 20;

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
static RECONCILE_LOCK: Mutex<()> = Mutex::new(());

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
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

struct KnownTrack {
    id: i64,
    stat: Option<(i64, i64)>,
    missing: bool,
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

/// For a source with a folder (`root` given), paths outside its root, inside
/// the Spiral folder but not the root, or hidden are dropped.
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
    let _serial = lock(&RECONCILE_LOCK);
    let source = sources::get_source(&lock(db), source_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Source {source_id} not found"))?;
    // Every source with a folder is walked; Other only gets missing marks.
    match source.root_path.as_deref() {
        Some(root) if source_id != sources::OTHER_SOURCE_ID => {
            reconcile_watched(db, ctx, source_id, root, scope)
        }
        _ => mark_missing(db, ctx, source_id, scope),
    }
}

/// Reconcile every source: a full pass over each source's folder, and
/// missing marks for Other. Used at startup to catch what changed while
/// Spiral was closed.
pub fn reconcile_all(db: &Mutex<Connection>, ctx: &ScanContext) -> Vec<ReconcileSummary> {
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
fn mark_missing(
    db: &Mutex<Connection>,
    ctx: &ScanContext,
    source_id: i64,
    scope: ReconcileScope<'_>,
) -> Result<ReconcileSummary, String> {
    let coverage = coverage(scope, None, &ctx.roots);
    let known = known_tracks(&lock(db), source_id, coverage.as_ref())?;
    let mut summary = ReconcileSummary::new(source_id);
    let changes: Vec<(i64, bool)> = known
        .iter()
        .filter_map(|(path, track)| {
            let exists = Path::new(path).is_file();
            (exists == track.missing).then_some((track.id, !exists))
        })
        .collect();
    let conn = lock(db);
    for (id, missing) in changes {
        set_missing(&conn, id, missing)?;
        if missing {
            summary.missing += 1;
        } else {
            summary.restored += 1;
        }
    }
    Ok(summary)
}

fn reconcile_watched(
    db: &Mutex<Connection>,
    ctx: &ScanContext,
    source_id: i64,
    root: &str,
    scope: ReconcileScope<'_>,
) -> Result<ReconcileSummary, String> {
    let root = PathBuf::from(root);
    let coverage = coverage(scope, Some(&root), &ctx.roots).unwrap_or_else(|| Coverage {
        dirs: vec![root.clone()],
        files: HashSet::new(),
    });

    // An unreachable root (an unplugged drive) yields no files, so every track
    // in scope is marked missing until it comes back.
    let mut found: Vec<String> = coverage
        .dirs
        .iter()
        .flat_map(|dir| audio_files_in_source(dir, &root, &ctx.roots))
        .collect();
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
    let mut summary = ReconcileSummary::new(source_id);

    for path in found {
        let Some(stat) = file_stat(Path::new(&path)) else {
            continue;
        };
        match known.remove(&path) {
            Some(track) => {
                // A NULL stat predates change tracking: record it and trust the
                // row, rather than re-reading every file once.
                let changed = track.stat.is_some_and(|s| s != stat);
                if changed {
                    match read_track(ctx, &path) {
                        Ok(input) => {
                            let conn = lock(db);
                            if !source_exists(&conn, source_id) {
                                return Ok(summary);
                            }
                            save(&conn, &input, source_id)?;
                            summary.updated += 1;
                        }
                        Err(err) => summary.fail(&path, err),
                    }
                }
                if track.missing {
                    summary.restored += 1;
                }
                if changed || track.missing || track.stat != Some(stat) {
                    set_present(&lock(db), track.id, stat)?;
                }
            }
            None => match read_track(ctx, &path) {
                Ok(input) => {
                    let conn = lock(db);
                    // Removed while we were reading: stop rather than recreate it.
                    if !source_exists(&conn, source_id) {
                        return Ok(summary);
                    }
                    let id = save(&conn, &input, source_id)?;
                    set_present(&conn, id, stat)?;
                    summary.added += 1;
                }
                Err(err) => summary.fail(&path, err),
            },
        }
    }

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
/// descending into hidden folders or the rest of the Spiral folder (a user
/// source may contain it). Empty when `dir` is not a folder.
fn audio_files_in_source(dir: &Path, root: &Path, roots: &LibraryRoots) -> Vec<String> {
    walkdir::WalkDir::new(dir)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            !(is_hidden_below(e.path(), root)
                || e.file_type().is_dir() && sources::is_outside_source_walk(e.path(), root, roots))
        })
        .filter_map(Result::ok)
        // `is_file` follows symlinks to files, as `file_scan` does.
        .filter(|e| {
            !e.file_type().is_dir() && e.path().is_file() && is_supported_audio_file(e.path())
        })
        .map(|e| e.path().to_string_lossy().into_owned())
        .collect()
}

fn read_track(ctx: &ScanContext, path: &str) -> Result<crate::models::TrackInput, String> {
    metadata_reader::parse_track_metadata_for_library(
        &ctx.app_data_dir,
        path,
        ctx.lyrics_sidecar_enabled,
        Some(&ctx.roots.library_root),
    )
}

/// Save a track read from a source's folder and make sure it belongs to it (a
/// row already at this path, e.g. an external reference, is claimed).
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

/// Point a user source at a new folder, e.g. after the collection moved to
/// another drive. Tracks store paths relative to the root, so this only
/// updates the source row; the caller should reconcile afterwards to pick up
/// what differs.
pub fn relocate_source(
    db: &Mutex<Connection>,
    ctx: &ScanContext,
    source_id: i64,
    new_root: &str,
) -> Result<Source, String> {
    let _serial = lock(&RECONCILE_LOCK);
    let conn = lock(db);
    let old_tracks = db::get_tracks_for_source(&conn, source_id).map_err(|e| e.to_string())?;
    let source = sources::set_source_root(&conn, &ctx.roots, source_id, new_root)?;

    // Art cached in app data is keyed by file path. Library Artwork/ paths are
    // left as they are by `migrate_art_cache`.
    let new_paths: HashMap<i64, String> = db::get_tracks_for_source(&conn, source_id)
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|t| (t.id, t.file_path))
        .collect();
    for track in old_tracks.iter().filter(|t| t.art_path.is_some()) {
        let Some(new_path) = new_paths.get(&track.id) else {
            continue;
        };
        match library_organize::migrate_art_cache(
            &ctx.app_data_dir,
            &track.file_path,
            new_path,
            track.art_path.as_deref(),
        ) {
            Ok(new_art) if new_art != track.art_path => {
                conn.execute(
                    "UPDATE tracks SET art_path = ?1 WHERE id = ?2",
                    params![new_art, track.id],
                )
                .map_err(|e| e.to_string())?;
            }
            Ok(_) => {}
            Err(err) => eprintln!("relocate source art cache: {err}"),
        }
    }
    Ok(source)
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
    use crate::sources::{DEFAULT_SOURCE_ID, OTHER_SOURCE_ID};
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

        // Rewritten, so it is read again as well as restored.
        fx.wav("Collection/Sub/a.wav");
        assert_eq!(fx.reconcile(id), summary(id, 0, 1, 0, 1));
        let track = db::get_track_by_id(&lock(&fx.db), a_id).unwrap().unwrap();
        assert_eq!(track.missing_since, None);
    }

    #[test]
    fn unreachable_root_marks_everything_missing() {
        let fx = Fixture::new("unplugged");
        let id = fx.watch("Drive/Music");
        fx.wav("Drive/Music/a.wav");
        fx.wav("Drive/Music/b.wav");
        fx.reconcile(id);
        fs::rename(fx.path("Drive"), fx.path("Unplugged")).unwrap();
        assert_eq!(fx.reconcile(id), summary(id, 0, 0, 2, 0));
        fs::rename(fx.path("Unplugged"), fx.path("Drive")).unwrap();
        assert_eq!(fx.reconcile(id), summary(id, 0, 0, 0, 2));
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
        assert_eq!(fx.reconcile_paths(id, &changed), summary(id, 1, 0, 1, 0));
        assert_eq!(
            fx.tracks(id),
            vec![(s(&new), "a".into(), false), (s(&old), "a".into(), true)]
        );
    }

    #[test]
    fn the_default_source_is_walked_and_other_gets_missing_marks() {
        let fx = Fixture::new("default");
        let managed = fx.wav("Music/Spiral Library/Tracks/a.wav");
        let external = fx.wav("Downloads/b.wav");
        for (path, source) in [(&managed, DEFAULT_SOURCE_ID), (&external, OTHER_SOURCE_ID)] {
            let input = crate::models::TrackInput {
                title: "Song".into(),
                file_path: s(path),
                ..Default::default()
            };
            db::save_track(&lock(&fx.db), &input, source).unwrap();
        }
        // Dropped into the tracks folder in Finder.
        let dropped = fx.wav("Music/Spiral Library/Tracks/Artist/dropped.wav");
        // Never walked: hidden folders (convert scratch) and the rest of the
        // Spiral folder.
        fx.wav("Music/Spiral Library/Tracks/.spiral-convert/1.wav");
        fx.wav("Music/Spiral Library/Tracks/._a.wav");
        fx.wav("Music/Spiral Library/Packs/sounds/pack/click.wav");
        // Other is never walked, so files beside its tracks stay out.
        fx.wav("Downloads/c.wav");

        assert_eq!(
            fx.reconcile(DEFAULT_SOURCE_ID),
            summary(DEFAULT_SOURCE_ID, 1, 0, 0, 0)
        );
        assert_eq!(
            fx.tracks(DEFAULT_SOURCE_ID),
            vec![
                (s(&dropped), "dropped".into(), false),
                (s(&managed), "Song".into(), false),
            ]
        );
        fs::remove_file(&managed).unwrap();
        fs::remove_file(&external).unwrap();
        let all = reconcile_all(&fx.db, &fx.ctx);
        assert_eq!(
            all,
            vec![
                summary(DEFAULT_SOURCE_ID, 0, 0, 1, 0),
                summary(OTHER_SOURCE_ID, 0, 0, 1, 0)
            ]
        );
        assert_eq!(
            fx.tracks(OTHER_SOURCE_ID),
            vec![(s(&external), "Song".into(), true)]
        );

        // Written again, so it is read again as well as restored.
        fx.wav("Music/Spiral Library/Tracks/a.wav");
        assert_eq!(
            fx.reconcile(DEFAULT_SOURCE_ID),
            summary(DEFAULT_SOURCE_ID, 0, 1, 0, 1)
        );

        // A watcher batch inside the tracks folder is reconciled; hidden
        // paths in it are ignored.
        let later = fx.wav("Music/Spiral Library/Tracks/later.wav");
        let hidden = fx.wav("Music/Spiral Library/Tracks/.spiral-convert/2.wav");
        assert_eq!(
            fx.reconcile_paths(DEFAULT_SOURCE_ID, &[later.clone(), hidden]),
            summary(DEFAULT_SOURCE_ID, 1, 0, 0, 0)
        );
        assert_eq!(fx.tracks(DEFAULT_SOURCE_ID).len(), 3);
    }

    #[test]
    fn a_new_file_already_referenced_as_external_joins_the_source() {
        let fx = Fixture::new("claim");
        let id = fx.watch("Collection");
        let a = fx.wav("Collection/a.wav");
        // Referenced from elsewhere after the folder was added.
        let input = crate::models::TrackInput {
            title: "Song".into(),
            file_path: s(&a),
            ..Default::default()
        };
        db::save_track(&lock(&fx.db), &input, OTHER_SOURCE_ID).unwrap();

        assert_eq!(fx.reconcile(id), summary(id, 1, 0, 0, 0));
        assert_eq!(fx.tracks(id).len(), 1);
        assert!(fx.tracks(OTHER_SOURCE_ID).is_empty());
        assert_eq!(fx.reconcile(id), summary(id, 0, 0, 0, 0));
    }

    #[test]
    fn a_watched_folder_around_the_library_skips_it() {
        let fx = Fixture::new("around");
        let managed = fx.wav("Music/Spiral Library/Tracks/Artist/Album/m.wav");
        let input = crate::models::TrackInput {
            title: "Managed".into(),
            file_path: s(&managed),
            ..Default::default()
        };
        let managed_id = db::save_track(&lock(&fx.db), &input, DEFAULT_SOURCE_ID).unwrap();
        // Untracked files in the tracks folder and a sound pack's audio.
        fx.wav("Music/Spiral Library/Tracks/Artist/Album/stray.wav");
        fx.wav("Music/Spiral Library/Packs/sounds/pack/click.wav");
        let loose = fx.wav("Music/SomeArtist/loose.wav");
        let top = fx.wav("Music/top.wav");

        let music = fx.watch("Music");
        assert_eq!(fx.reconcile(music), summary(music, 2, 0, 0, 0));
        assert_eq!(
            fx.tracks(music),
            vec![
                (s(&loose), "loose".into(), false),
                (s(&top), "top".into(), false),
            ]
        );
        assert_eq!(
            fx.tracks(DEFAULT_SOURCE_ID),
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
        assert_eq!(
            (track.source_id, track.missing_since),
            (DEFAULT_SOURCE_ID, None)
        );
        // The default source's own pass marks it, and picks up the stray file
        // the user source skipped.
        assert_eq!(
            fx.reconcile(DEFAULT_SOURCE_ID),
            summary(DEFAULT_SOURCE_ID, 1, 0, 1, 0)
        );
    }

    #[test]
    fn relocate_rewrites_paths_and_clears_missing() {
        let fx = Fixture::new("relocate");
        let id = fx.watch("Old/Music");
        let other = fx.watch("Other");
        fx.wav("Old/Music/a.wav");
        fx.wav("Old/Music/Sub/b.wav");
        fx.reconcile(id);
        let a_id = fx.track_id(&fx.path("Old/Music/a.wav"));
        let old_cache = art_cache::write_bytes_to_art_cache(
            &fx.ctx.app_data_dir,
            &s(&fx.path("Old/Music/a.wav")),
            b"art",
            "jpg",
        )
        .unwrap();
        lock(&fx.db)
            .execute(
                "UPDATE tracks SET art_path = ?1 WHERE id = ?2",
                params![s(&old_cache), a_id],
            )
            .unwrap();

        fs::create_dir_all(fx.path("New")).unwrap();
        fs::rename(fx.path("Old/Music"), fx.path("New/Music")).unwrap();
        assert_eq!(fx.reconcile(id), summary(id, 0, 0, 2, 0));

        // Validation still applies, against everything but the source itself.
        let err = relocate_source(&fx.db, &fx.ctx, id, &s(&fx.path("Other/Sub")));
        assert!(err.is_err());
        let err = relocate_source(&fx.db, &fx.ctx, other, &s(&fx.path("New/Music")));
        assert!(err.is_ok(), "{err:?}");
        relocate_source(&fx.db, &fx.ctx, other, &s(&fx.path("Other"))).unwrap();

        let source = relocate_source(&fx.db, &fx.ctx, id, &s(&fx.path("New/Music"))).unwrap();
        assert_eq!(source.root_path, Some(s(&fx.path("New/Music"))));
        assert_eq!(fx.reconcile(id), summary(id, 0, 0, 0, 2));
        assert_eq!(
            fx.tracks(id),
            vec![
                (s(&fx.path("New/Music/Sub/b.wav")), "b".into(), false),
                (s(&fx.path("New/Music/a.wav")), "a".into(), false),
            ]
        );
        assert_eq!(fx.track_id(&fx.path("New/Music/a.wav")), a_id);

        // The cached art moved with its key.
        let track = db::get_track_by_id(&lock(&fx.db), a_id).unwrap().unwrap();
        let new_cache = PathBuf::from(track.art_path.unwrap());
        assert_ne!(new_cache, old_cache);
        assert!(new_cache.is_file());
        assert!(!old_cache.exists());

        assert!(relocate_source(&fx.db, &fx.ctx, DEFAULT_SOURCE_ID, &s(&fx.path("New"))).is_err());
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
}
