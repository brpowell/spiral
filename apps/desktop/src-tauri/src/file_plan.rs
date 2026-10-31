//! Plans of file operations on tracks: build, preview, then apply with a journal.
//!
//! Every move of a track's file goes through here. Building a plan only reads
//! (the database and the disk) and reports a [`Conflict`] per operation, so the
//! user can see what would happen ("N files will move") before anything does.
//! Applying runs the operations in order, holding off reconciles meanwhile
//! ([`source_scan::exclusive`]), and records each step in a journal first.
//!
//! The journal is an append-only JSON Lines file in the Spiral folder
//! ([`JOURNAL_FILE`]): one line with the whole plan, then a `begin` line
//! before each move and a `done` or `skip` line after it. It is a file rather
//! than a table so a plan needs no schema change, and appending a line per
//! step stays cheap for thousands of moves. Each step is written to be redone
//! safely, deciding from the disk whether the file already moved, so the
//! journal needs no transaction with the database.
//!
//! After a crash an unfinished journal is completed (rolled forward) by
//! [`recover`] at startup: the step in flight is finished from where its file
//! is, the remaining steps run, and the plan's [`Finish`] is applied. Rolling
//! back would move as many files, and the user already confirmed the plan.
//!
//! Only [`FileOp::Move`] exists today. Its endpoints carry their source, so a
//! move into another source (merging sources) is already a plan of moves whose
//! `to.source_id` differs. Mirroring would add a `Copy` variant that writes
//! the file and inserts a row in the target source instead of updating one;
//! [`run_step`] is the only place that would need a second arm, plus a
//! [`Finish`] variant for whatever ends the operation (e.g. removing the
//! merged source).

use crate::fs_move;
use crate::library_organize::{self, OrganizeMetadata};
use crate::lyrics_sidecar;
use crate::source_scan;
use crate::sources::{self, LibraryRoots, SourceRoots};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;

/// The journal of a plan being applied, in the Spiral folder. Present only
/// while a plan is applying, or after a crash until [`recover`] finishes it.
pub const JOURNAL_FILE: &str = "File Moves.jsonl";

pub fn journal_path(spiral_folder: &Path) -> PathBuf {
    spiral_folder.join(JOURNAL_FILE)
}

/// Where a track's file is, or is going: its source, its path as stored in
/// that source, and the absolute path.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Location {
    pub source_id: i64,
    pub rel_path: String,
    pub path: PathBuf,
}

/// One file operation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum FileOp {
    /// Move a track's file (and what follows it: its lyrics sidecar, its
    /// cached art) and point the track's row at the new place.
    #[serde(rename_all = "camelCase")]
    Move {
        track_id: i64,
        from: Location,
        to: Location,
    },
}

impl FileOp {
    #[cfg_attr(not(test), allow(dead_code))] // For planners comparing ops (merging).
    pub fn track_id(&self) -> i64 {
        match self {
            FileOp::Move { track_id, .. } => *track_id,
        }
    }

    pub fn from(&self) -> &Location {
        match self {
            FileOp::Move { from, .. } => from,
        }
    }

    #[cfg_attr(not(test), allow(dead_code))] // For planners comparing ops (merging).
    pub fn to(&self) -> &Location {
        match self {
            FileOp::Move { to, .. } => to,
        }
    }
}

/// Why an operation can't go exactly as wanted.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Conflict {
    /// Another file is already at the wanted path; the operation goes to a
    /// numbered name (`Song (2).mp3`) instead.
    #[serde(rename_all = "camelCase")]
    TargetExists { wanted: String },
    /// An earlier track in the plan wants the same path; this one gets a
    /// numbered name instead.
    #[serde(rename_all = "camelCase")]
    DuplicateTarget { wanted: String, other_track_id: i64 },
    /// The track's file isn't there. Skipped.
    SourceMissing,
    /// The track's file can't be read. Skipped.
    #[serde(rename_all = "camelCase")]
    SourceUnreadable { error: String },
    /// The target would be inside the Spiral folder, which isn't a source.
    /// Skipped.
    InsideSpiralFolder,
    /// A part of the target starts with a dot (e.g. a title like `.hack`).
    /// Walks and the watcher skip hidden entries, so the track would read as
    /// missing. Skipped.
    HiddenTarget,
    /// No target could be worked out (e.g. the path format is empty). Skipped.
    #[serde(rename_all = "camelCase")]
    InvalidTarget { error: String },
}

impl Conflict {
    /// True when the operation is skipped rather than renamed.
    pub fn blocks(&self) -> bool {
        !matches!(
            self,
            Conflict::TargetExists { .. } | Conflict::DuplicateTarget { .. }
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlannedOp {
    pub op: FileOp,
    pub conflict: Option<Conflict>,
}

impl PlannedOp {
    pub fn runs(&self) -> bool {
        self.conflict.as_ref().is_none_or(|c| !c.blocks())
    }
}

/// What to do once every step has run.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Finish {
    /// Turn organizing on for the source, and set its path format if given.
    #[serde(rename_all = "camelCase")]
    OrganizeSource {
        source_id: i64,
        path_format: Option<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilePlan {
    pub ops: Vec<PlannedOp>,
    /// Tracks looked at that are already where they belong.
    pub unchanged: usize,
    /// Folders emptied by the plan are pruned up to (not including) these.
    pub roots: BTreeMap<i64, PathBuf>,
    pub finish: Option<Finish>,
}

/// How many moves and conflicts a preview lists by name.
pub const PREVIEW_SAMPLE: usize = 50;
pub const PREVIEW_CONFLICTS: usize = 200;

/// A plan for the user to confirm: counts, a sample of moves, the conflicts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanSummary {
    /// Files that will move, renamed ones included.
    pub moves: usize,
    /// Of those, the ones going to a numbered name.
    pub renamed: usize,
    /// Tracks that will stay put because of a conflict.
    pub skipped: usize,
    pub unchanged: usize,
    pub sample: Vec<PlannedOp>,
    pub conflicts: Vec<PlannedOp>,
}

impl FilePlan {
    pub fn summary(&self) -> PlanSummary {
        let moves = self.ops.iter().filter(|op| op.runs()).count();
        PlanSummary {
            moves,
            renamed: self
                .ops
                .iter()
                .filter(|op| op.runs() && op.conflict.is_some())
                .count(),
            skipped: self.ops.len() - moves,
            unchanged: self.unchanged,
            sample: self
                .ops
                .iter()
                .filter(|op| op.runs())
                .take(PREVIEW_SAMPLE)
                .cloned()
                .collect(),
            conflicts: self
                .ops
                .iter()
                .filter(|op| op.conflict.is_some())
                .take(PREVIEW_CONFLICTS)
                .cloned()
                .collect(),
        }
    }
}

/// Key for comparing stored paths: case-folded, since macOS and Windows
/// volumes usually are, and two targets differing only in case collide there.
fn path_key(rel_path: &str) -> String {
    rel_path.to_lowercase()
}

/// Whether two paths are the same file on disk (a case-only rename on a
/// case-insensitive volume, a symlinked folder).
fn same_file(a: &Path, b: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        match (fs::metadata(a), fs::metadata(b)) {
            (Ok(x), Ok(y)) => x.dev() == y.dev() && x.ino() == y.ino(),
            _ => false,
        }
    }
    #[cfg(not(unix))]
    {
        a.exists() && library_organize::same_path(a, b)
    }
}

struct OrganizeRow {
    id: i64,
    rel_path: String,
    title: String,
    artist: Option<String>,
    album: Option<String>,
    album_artist: Option<String>,
    track_number: Option<i32>,
    disc_number: Option<i32>,
    year: Option<i32>,
    genre: Option<String>,
}

impl OrganizeRow {
    fn meta(&self) -> OrganizeMetadata<'_> {
        OrganizeMetadata {
            title: &self.title,
            artist: self.artist.as_deref(),
            album: self.album.as_deref(),
            album_artist: self.album_artist.as_deref(),
            track_number: self.track_number,
            disc_number: self.disc_number,
            year: self.year,
            genre: self.genre.as_deref(),
        }
    }
}

/// The path format organizing `source_id` uses: `format` when given, else
/// the one it is organized with, else (organizing is off, which is when it
/// gets turned on) its own format or `default_format`, the global one.
fn organize_format(
    conn: &Connection,
    source_id: i64,
    format: Option<String>,
    organized_with: Option<String>,
    default_format: &str,
) -> Result<String, String> {
    if let Some(format) = format.filter(|f| !f.trim().is_empty()).or(organized_with) {
        return Ok(format);
    }
    let source = sources::get_source(conn, source_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Source {source_id} not found"))?;
    Ok(source
        .path_format
        .filter(|f| !f.trim().is_empty())
        .unwrap_or_else(|| default_format.to_string()))
}

/// Plan moving every present track of a source to where its path format puts
/// it, as organizing on import and tag edit would. `format` overrides the
/// source's format (to preview one before saving it); `default_format` is the
/// global format a source without its own inherits. Reads only.
///
/// Targets that are taken (a file on disk, another row, or an earlier track in
/// the plan) get a numbered name as [`library_organize::unique_path`] would.
/// A path a track earlier in the plan moves away from counts as free, since
/// that move runs first.
pub fn plan_organize_source(
    conn: &Connection,
    source_id: i64,
    format: Option<String>,
    default_format: &str,
) -> Result<FilePlan, String> {
    if source_id == sources::OTHER_SOURCE_ID {
        return Err("Other has no folder, so it can't be organized".to_string());
    }
    // Where organizing writes, as import does; fails when a user source's
    // folder isn't reachable.
    let target = sources::write_target(conn, source_id, default_format)?;
    let format = organize_format(conn, source_id, format, target.path_format, default_format)?;
    let root = target.root;
    let roots = SourceRoots::load(conn).map_err(|e| e.to_string())?;
    // Targets a walk of this source would skip: the Spiral folder (for the
    // default source, the part outside its own folder) and hidden entries.
    let library_roots = sources::spiral_folder(conn)
        .map_err(|e| e.to_string())?
        .map(|folder| LibraryRoots::for_library_root(&folder));

    // Every row's path, missing ones included: a target must not collide
    // with a row even when its file is gone.
    let mut stored: HashSet<String> = HashSet::new();
    let mut rows = Vec::new();
    {
        let mut stmt = conn
            .prepare(
                "SELECT id, rel_path, title, artist, album, album_artist, track_number,
                        disc_number, year, genre, missing_since IS NOT NULL
                 FROM tracks WHERE source_id = ?1 ORDER BY rel_path, id",
            )
            .map_err(|e| e.to_string())?;
        let mapped = stmt
            .query_map(params![source_id], |row| {
                Ok((
                    OrganizeRow {
                        id: row.get(0)?,
                        rel_path: row.get(1)?,
                        title: row.get(2)?,
                        artist: row.get(3)?,
                        album: row.get(4)?,
                        album_artist: row.get(5)?,
                        track_number: row.get(6)?,
                        disc_number: row.get(7)?,
                        year: row.get(8)?,
                        genre: row.get(9)?,
                    },
                    row.get::<_, bool>(10)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        for row in mapped {
            let (row, missing) = row.map_err(|e| e.to_string())?;
            stored.insert(path_key(&row.rel_path));
            if !missing {
                rows.push(row);
            }
        }
    }

    let mut plan = FilePlan {
        ops: Vec::new(),
        unchanged: 0,
        roots: BTreeMap::from([(source_id, root.clone())]),
        finish: None,
    };
    // Targets handed out so far, and paths earlier moves leave free.
    let mut claimed: HashMap<String, i64> = HashMap::new();
    let mut vacated: HashSet<String> = HashSet::new();

    for row in rows {
        let from_path = roots.resolve(source_id, &row.rel_path);
        let from = Location {
            source_id,
            rel_path: row.rel_path.clone(),
            path: PathBuf::from(&from_path),
        };
        let blocked = |to: Location, conflict: Conflict| PlannedOp {
            op: FileOp::Move {
                track_id: row.id,
                from: from.clone(),
                to,
            },
            conflict: Some(conflict),
        };

        let wanted =
            match library_organize::build_organized_path(&root, &from.path, &row.meta(), &format) {
                Ok(path) => path,
                Err(error) => {
                    plan.ops
                        .push(blocked(from.clone(), Conflict::InvalidTarget { error }));
                    continue;
                }
            };
        let wanted_rel = roots.relative_path(source_id, &wanted)?;
        if wanted_rel == row.rel_path {
            plan.unchanged += 1;
            continue;
        }
        let wanted_loc = Location {
            source_id,
            rel_path: wanted_rel.clone(),
            path: wanted.clone(),
        };
        if !from.path.is_file() {
            plan.ops.push(blocked(wanted_loc, Conflict::SourceMissing));
            continue;
        }
        if let Err(err) = fs::File::open(&from.path) {
            plan.ops.push(blocked(
                wanted_loc,
                Conflict::SourceUnreadable {
                    error: err.to_string(),
                },
            ));
            continue;
        }
        if library_roots
            .as_ref()
            .is_some_and(|lr| sources::is_outside_source_walk(&wanted, &root, lr))
        {
            plan.ops
                .push(blocked(wanted_loc, Conflict::InsideSpiralFolder));
            continue;
        }
        if source_scan::is_hidden_below(&wanted, &root) {
            plan.ops.push(blocked(wanted_loc, Conflict::HiddenTarget));
            continue;
        }

        let own_key = path_key(&row.rel_path);
        let is_free = |candidate: &Path| -> bool {
            let Ok(rel) = roots.relative_path(source_id, candidate) else {
                return false;
            };
            let key = path_key(&rel);
            if claimed.contains_key(&key) {
                return false;
            }
            if key == own_key || vacated.contains(&key) {
                return true;
            }
            !stored.contains(&key) && !candidate.exists()
        };
        let target = library_organize::unique_path_by(wanted.clone(), is_free);
        let target_rel = roots.relative_path(source_id, &target)?;
        if target_rel == row.rel_path {
            // Already at the numbered name it would get.
            plan.unchanged += 1;
            continue;
        }
        let conflict = (target != wanted).then(|| match claimed.get(&path_key(&wanted_rel)) {
            Some(&other_track_id) => Conflict::DuplicateTarget {
                wanted: wanted_rel.clone(),
                other_track_id,
            },
            None => Conflict::TargetExists {
                wanted: wanted_rel.clone(),
            },
        });
        claimed.insert(path_key(&target_rel), row.id);
        vacated.insert(own_key);
        plan.ops.push(PlannedOp {
            op: FileOp::Move {
                track_id: row.id,
                from,
                to: Location {
                    source_id,
                    rel_path: target_rel,
                    path: target,
                },
            },
            conflict,
        });
    }
    Ok(plan)
}

/// Progress through a plan being applied.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub done: usize,
    pub total: usize,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplySummary {
    pub moved: usize,
    /// Steps that couldn't run (their file was gone, or the move failed).
    pub failed: usize,
    pub errors: Vec<String>,
}

const MAX_ERRORS: usize = 20;

impl ApplySummary {
    fn fail(&mut self, path: &Path, err: impl std::fmt::Display) {
        self.failed += 1;
        if self.errors.len() < MAX_ERRORS {
            self.errors.push(format!("{}: {err}", path.display()));
        }
    }
}

/// What applying needs besides the plan.
#[derive(Debug, Clone)]
pub struct ApplyContext {
    pub journal: PathBuf,
    /// For moving legacy cached art keyed by the file's path; `None` skips it.
    pub app_data_dir: Option<PathBuf>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum Entry {
    Plan {
        steps: Vec<FileOp>,
        /// Pairs rather than a map: integer map keys don't read back inside
        /// a tagged enum.
        roots: Vec<(i64, PathBuf)>,
        finish: Option<Finish>,
    },
    /// About to run step `step`, to `to` (which may differ from the plan's
    /// when its target was taken since planning).
    Begin {
        step: usize,
        to: Location,
    },
    Done {
        step: usize,
    },
    Skip {
        step: usize,
        error: String,
    },
}

struct Journal {
    file: fs::File,
}

impl Journal {
    fn create(path: &Path, first: &Entry) -> Result<Self, String> {
        if path.exists() {
            return Err("Another file move is unfinished; restart Spiral to finish it".into());
        }
        let file = fs::OpenOptions::new()
            .create_new(true)
            .append(true)
            .open(path)
            .map_err(|e| format!("failed to create file move journal: {e}"))?;
        let mut journal = Self { file };
        journal.append(first)?;
        Ok(journal)
    }

    fn open(path: &Path) -> Result<Self, String> {
        let file = fs::OpenOptions::new()
            .append(true)
            .open(path)
            .map_err(|e| format!("failed to open file move journal: {e}"))?;
        Ok(Self { file })
    }

    /// Append one line and flush it to disk before going on.
    fn append(&mut self, entry: &Entry) -> Result<(), String> {
        let mut line = serde_json::to_string(entry).map_err(|e| e.to_string())?;
        line.push('\n');
        self.file
            .write_all(line.as_bytes())
            .and_then(|()| self.file.sync_data())
            .map_err(|e| format!("failed to write file move journal: {e}"))
    }
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// Apply a plan: run each operation that isn't blocked by a conflict, in
/// order, then prune emptied folders and apply its [`Finish`]. Reconciles wait
/// until it's done. Blocking; call it off the main thread.
pub fn apply(
    db: &Mutex<Connection>,
    ctx: &ApplyContext,
    plan: &FilePlan,
    on_progress: impl FnMut(Progress),
) -> Result<ApplySummary, String> {
    let _serial = source_scan::exclusive();
    let steps: Vec<FileOp> = plan
        .ops
        .iter()
        .filter(|op| op.runs())
        .map(|op| op.op.clone())
        .collect();
    let mut journal = Journal::create(
        &ctx.journal,
        &Entry::Plan {
            steps: steps.clone(),
            roots: plan.roots.clone().into_iter().collect(),
            finish: plan.finish.clone(),
        },
    )?;
    let pending = steps
        .into_iter()
        .enumerate()
        .map(|(i, op)| (i, op, false))
        .collect();
    run(
        db,
        ctx,
        &mut journal,
        pending,
        &plan.roots,
        plan.finish.as_ref(),
        on_progress,
    )
}

/// Run `pending` steps (index, op, whether it had begun before a crash),
/// prune, finish, and remove the journal.
fn run(
    db: &Mutex<Connection>,
    ctx: &ApplyContext,
    journal: &mut Journal,
    pending: Vec<(usize, FileOp, bool)>,
    roots: &BTreeMap<i64, PathBuf>,
    finish: Option<&Finish>,
    mut on_progress: impl FnMut(Progress),
) -> Result<ApplySummary, String> {
    let total = pending.len();
    let mut summary = ApplySummary::default();
    let mut emptied: BTreeSet<(i64, PathBuf)> = BTreeSet::new();
    on_progress(Progress { done: 0, total });
    for (done, (step, op, begun)) in pending.into_iter().enumerate() {
        match run_step(db, ctx, journal, step, &op, begun)? {
            Ok(()) => {
                summary.moved += 1;
                let from = op.from();
                if let Some(parent) = from.path.parent() {
                    emptied.insert((from.source_id, parent.to_path_buf()));
                }
            }
            Err(err) => summary.fail(&op.from().path, err),
        }
        on_progress(Progress {
            done: done + 1,
            total,
        });
    }

    for (source_id, dir) in emptied {
        if let Some(root) = roots.get(&source_id) {
            prune_inside(&dir, root);
        }
    }
    if let Some(finish) = finish {
        apply_finish(&lock(db), finish)?;
    }
    fs::remove_file(&ctx.journal)
        .map_err(|e| format!("failed to remove file move journal: {e}"))?;
    Ok(summary)
}

/// Remove empty folders from `dir` up to, not including, `root`. Both are
/// resolved first, so a symlinked folder leading out of the root is left alone.
fn prune_inside(dir: &Path, root: &Path) {
    let (Ok(dir), Ok(root)) = (dir.canonicalize(), root.canonicalize()) else {
        return;
    };
    if dir.starts_with(&root) {
        library_organize::prune_empty_dirs(&dir, &root);
    }
}

fn apply_finish(conn: &Connection, finish: &Finish) -> Result<(), String> {
    match finish {
        Finish::OrganizeSource {
            source_id,
            path_format,
        } => {
            if path_format.is_some() {
                sources::set_source_path_format(conn, *source_id, path_format.clone())?;
            }
            sources::set_source_organize(conn, *source_id, true)?;
        }
    }
    Ok(())
}

/// Whether `loc` is free for `track_id` to move to: nothing on disk there and
/// no other row stored at it.
fn target_free(conn: &Connection, loc: &Location, path: &Path, track_id: i64) -> bool {
    if path.exists() {
        return false;
    }
    let Ok(roots) = SourceRoots::load(conn) else {
        return false;
    };
    let Ok(rel) = roots.relative_path(loc.source_id, path) else {
        return false;
    };
    let other: Option<i64> = conn
        .query_row(
            "SELECT id FROM tracks WHERE source_id = ?1 AND rel_path = ?2 AND id != ?3",
            params![loc.source_id, rel, track_id],
            |row| row.get(0),
        )
        .optional()
        .unwrap_or(Some(-1));
    other.is_none()
}

/// Run one step. The outer error stops the whole apply (the journal can't be
/// written); the inner one fails just this step.
fn run_step(
    db: &Mutex<Connection>,
    ctx: &ApplyContext,
    journal: &mut Journal,
    step: usize,
    op: &FileOp,
    begun: bool,
) -> Result<Result<(), String>, String> {
    let FileOp::Move { track_id, from, to } = op;
    let mut to = to.clone();

    let from_there = from.path.is_file();
    let to_there = to.path.exists();
    if begun && !from_there && to_there {
        // Moved before the crash; finish what follows the file.
        return finish_move(db, ctx, journal, step, *track_id, from, &to).map(Ok);
    }
    if !from_there {
        journal.append(&Entry::Skip {
            step,
            error: "file is gone".into(),
        })?;
        return Ok(Err("file is gone".into()));
    }
    if begun && to_there && !same_file(&from.path, &to.path) {
        // A copy across volumes that didn't finish. The target was free when
        // the step began, so whatever is there is ours.
        let _ = fs::remove_file(&to.path);
    }

    if !same_file(&from.path, &to.path) {
        // Taken since planning: pick the next free name, as planning would.
        let conn = lock(db);
        if !target_free(&conn, &to, &to.path, *track_id) {
            let path = library_organize::unique_path_by(to.path.clone(), |c| {
                target_free(&conn, &to, c, *track_id)
            });
            let roots = SourceRoots::load(&conn).map_err(|e| e.to_string())?;
            to.rel_path = roots.relative_path(to.source_id, &path)?;
            to.path = path;
        }
    }

    journal.append(&Entry::Begin {
        step,
        to: to.clone(),
    })?;
    if let Some(parent) = to.path.parent() {
        if let Err(err) = fs::create_dir_all(parent) {
            journal.append(&Entry::Skip {
                step,
                error: err.to_string(),
            })?;
            return Ok(Err(format!("failed to create folder: {err}")));
        }
    }
    if let Err(err) = fs_move::rename_or_copy_file(&from.path, &to.path) {
        journal.append(&Entry::Skip {
            step,
            error: err.clone(),
        })?;
        return Ok(Err(err));
    }
    finish_move(db, ctx, journal, step, *track_id, from, &to).map(Ok)
}

/// After the audio file is at `to`: move its lyrics sidecar and cached art,
/// point its row there, and mark the step done. Safe to repeat.
fn finish_move(
    db: &Mutex<Connection>,
    ctx: &ApplyContext,
    journal: &mut Journal,
    step: usize,
    track_id: i64,
    from: &Location,
    to: &Location,
) -> Result<(), String> {
    lyrics_sidecar::move_sidecar(&from.path, &to.path);
    let stat = fs::metadata(&to.path).ok().map(|m| {
        let mtime = m
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map_or(0, |d| d.as_millis() as i64);
        (m.len() as i64, mtime)
    });
    {
        let conn = lock(db);
        let art_path: Option<String> = conn
            .query_row(
                "SELECT art_path FROM tracks WHERE id = ?1",
                params![track_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?
            .flatten();
        let art_path = match &ctx.app_data_dir {
            Some(app_data) => library_organize::migrate_art_cache(
                app_data,
                &from.path.to_string_lossy(),
                &to.path.to_string_lossy(),
                art_path.as_deref(),
            )
            .unwrap_or(art_path),
            None => art_path,
        };
        // The stat keeps a later reconcile from reading the file again.
        conn.execute(
            "UPDATE tracks SET source_id = ?1, rel_path = ?2, art_path = ?3,
                    file_size = COALESCE(?4, file_size), file_mtime_ms = COALESCE(?5, file_mtime_ms)
             WHERE id = ?6",
            params![
                to.source_id,
                to.rel_path,
                art_path,
                stat.map(|s| s.0),
                stat.map(|s| s.1),
                track_id
            ],
        )
        .map_err(|e| format!("failed to update track {track_id}: {e}"))?;
    }
    journal.append(&Entry::Done { step })
}

/// Finish a plan a crash left unfinished, if there is one: the steps not done
/// yet run (one that had begun is finished from where its file is), then the
/// plan's folders are pruned and its [`Finish`] applied. When a source folder
/// in the plan can't be reached (an unplugged drive), the journal is kept for
/// the next start rather than giving up on its steps. Returns `None` when
/// there was nothing to recover.
pub fn recover(
    db: &Mutex<Connection>,
    ctx: &ApplyContext,
    on_progress: impl FnMut(Progress),
) -> Result<Option<ApplySummary>, String> {
    let _serial = source_scan::exclusive();
    let file = match fs::File::open(&ctx.journal) {
        Ok(file) => file,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(err) => return Err(format!("failed to read file move journal: {err}")),
    };
    let mut reader = BufReader::new(file);
    let mut first = String::new();
    reader
        .read_line(&mut first)
        .map_err(|e| format!("failed to read file move journal: {e}"))?;
    if !first.ends_with('\n') {
        // Crashed while writing the plan: nothing moved yet.
        fs::remove_file(&ctx.journal).map_err(|e| e.to_string())?;
        return Ok(None);
    }
    let Ok(Entry::Plan {
        steps,
        roots,
        finish,
    }) = serde_json::from_str::<Entry>(&first)
    else {
        // Keep it: moves may have run, and nothing here can tell which.
        return Err(format!(
            "{} can't be read; leaving it for a later version",
            ctx.journal.display()
        ));
    };
    let roots: BTreeMap<i64, PathBuf> = roots.into_iter().collect();
    if let Some(root) = roots.values().find(|root| !root.is_dir()) {
        return Err(format!(
            "{} can't be reached; unfinished file moves will resume when it can",
            root.display()
        ));
    }

    let mut begun: HashMap<usize, Location> = HashMap::new();
    let mut settled: HashSet<usize> = HashSet::new();
    // A torn last line (the crash hit mid-write) doesn't parse; skip it.
    for entry in reader
        .lines()
        .map_while(Result::ok)
        .filter_map(|line| serde_json::from_str::<Entry>(&line).ok())
    {
        match entry {
            Entry::Begin { step, to } => {
                begun.insert(step, to);
            }
            Entry::Done { step } | Entry::Skip { step, .. } => {
                settled.insert(step);
            }
            Entry::Plan { .. } => {}
        }
    }
    let pending = steps
        .into_iter()
        .enumerate()
        .filter(|(i, _)| !settled.contains(i))
        .map(|(i, op)| match (op, begun.remove(&i)) {
            (FileOp::Move { track_id, from, .. }, Some(to)) => {
                (i, FileOp::Move { track_id, from, to }, true)
            }
            (op, None) => (i, op, false),
        })
        .collect();
    let mut journal = Journal::open(&ctx.journal)?;
    run(
        db,
        ctx,
        &mut journal,
        pending,
        &roots,
        finish.as_ref(),
        on_progress,
    )
    .map(Some)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db_migrations;
    use crate::source_scan::{ReconcileScope, ScanContext};
    use crate::sources::DEFAULT_SOURCE_ID;
    use crate::test_fixtures::wav;
    use chrono::Utc;

    const FORMAT: &str = "{albumArtist}/{album}/{title}.{ext}";

    struct Fixture {
        dir: PathBuf,
        library: PathBuf,
        db: Mutex<Connection>,
    }

    impl Fixture {
        fn new(label: &str) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "spiral-file-plan-{label}-{}-{}",
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
                dir,
                library,
                db: Mutex::new(conn),
            }
        }

        fn path(&self, rel: &str) -> PathBuf {
            self.dir.join(rel)
        }

        fn roots(&self) -> LibraryRoots {
            LibraryRoots::for_library_root(&self.library)
        }

        fn ctx(&self) -> ApplyContext {
            ApplyContext {
                journal: journal_path(&self.library),
                app_data_dir: None,
            }
        }

        fn scan_ctx(&self) -> ScanContext {
            ScanContext {
                app_data_dir: self.dir.join("AppData"),
                roots: self.roots(),
                lyrics_sidecar_enabled: false,
            }
        }

        /// A user source at `rel` (organize off, as added).
        fn source(&self, rel: &str) -> i64 {
            let root = self.path(rel);
            fs::create_dir_all(&root).unwrap();
            sources::add_source(
                &lock(&self.db),
                &self.roots(),
                &root.to_string_lossy(),
                None,
            )
            .unwrap()
            .id
        }

        /// A track row in `source_id` for a small WAV written at `rel` (under
        /// the fixture's folder), tagged with `artist`, `album` and `title`.
        fn track(&self, source_id: i64, rel: &str, artist: &str, album: &str, title: &str) -> i64 {
            let path = self.path(rel);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            wav::write_minimal(&path);
            self.row(source_id, &path, artist, album, title)
        }

        /// A track row only; no file is written.
        fn row(&self, source_id: i64, path: &Path, artist: &str, album: &str, title: &str) -> i64 {
            let conn = lock(&self.db);
            let rel = SourceRoots::load(&conn)
                .unwrap()
                .relative_path(source_id, path)
                .unwrap();
            conn.execute(
                "INSERT INTO tracks (title, artist, album, rel_path, date_added, source_id)
                 VALUES (?1, ?2, ?3, ?4, '2026-01-01T00:00:00Z', ?5)",
                params![title, artist, album, rel, source_id],
            )
            .unwrap();
            conn.last_insert_rowid()
        }

        fn rel_path(&self, id: i64) -> String {
            lock(&self.db)
                .query_row(
                    "SELECT rel_path FROM tracks WHERE id = ?1",
                    params![id],
                    |row| row.get(0),
                )
                .unwrap()
        }

        fn plan(&self, source_id: i64) -> FilePlan {
            plan_organize_source(
                &lock(&self.db),
                source_id,
                Some(FORMAT.into()),
                "{title}.{ext}",
            )
            .unwrap()
        }

        fn apply(&self, plan: &FilePlan) -> ApplySummary {
            apply(&self.db, &self.ctx(), plan, |_| {}).unwrap()
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.dir);
        }
    }

    fn targets(plan: &FilePlan) -> Vec<(i64, String, Option<Conflict>)> {
        plan.ops
            .iter()
            .map(|op| {
                (
                    op.op.track_id(),
                    op.op.to().rel_path.clone(),
                    op.conflict.clone(),
                )
            })
            .collect()
    }

    #[test]
    fn plans_moves_to_the_format_and_skips_tracks_already_in_place() {
        let fx = Fixture::new("plan");
        let src = fx.source("Collection");
        let a = fx.track(src, "Collection/loose/a.wav", "Band", "First", "Song A");
        fx.track(
            src,
            "Collection/Band/First/Song B.wav",
            "Band",
            "First",
            "Song B",
        );

        let plan = fx.plan(src);
        assert_eq!(
            targets(&plan),
            vec![(a, "Band/First/Song A.wav".to_string(), None)]
        );
        assert_eq!(plan.unchanged, 1);
        let summary = plan.summary();
        assert_eq!((summary.moves, summary.renamed, summary.skipped), (1, 0, 0));
        // Planning only reads.
        assert!(fx.path("Collection/loose/a.wav").is_file());
        assert!(!fx.path("Collection/Band").join("First/Song A.wav").exists());
    }

    #[test]
    fn source_format_then_global_default_are_used_when_none_is_given() {
        let fx = Fixture::new("formats");
        let src = fx.source("Collection");
        let a = fx.track(src, "Collection/x.wav", "Band", "Album", "Song");
        let plan = |format: Option<&str>| {
            let conn = lock(&fx.db);
            targets(
                &plan_organize_source(
                    &conn,
                    src,
                    format.map(String::from),
                    "{artist}/{title}.{ext}",
                )
                .unwrap(),
            )
        };
        assert_eq!(plan(None), vec![(a, "Band/Song.wav".into(), None)]);
        sources::set_source_path_format(&lock(&fx.db), src, Some("{album}/{title}.{ext}".into()))
            .unwrap();
        assert_eq!(plan(None), vec![(a, "Album/Song.wav".into(), None)]);
        assert_eq!(
            plan(Some("{title}.{ext}")),
            vec![(a, "Song.wav".into(), None)]
        );
    }

    #[test]
    fn taken_targets_get_numbered_names_and_report_why() {
        let fx = Fixture::new("conflicts");
        let src = fx.source("Collection");
        // A stranger's file already at the target.
        fs::create_dir_all(fx.path("Collection/Band/Album")).unwrap();
        fs::write(fx.path("Collection/Band/Album/Song.wav"), b"not ours").unwrap();
        let a = fx.track(src, "Collection/a.wav", "Band", "Album", "Song");
        // Two tracks wanting one name.
        let b = fx.track(src, "Collection/b.wav", "Band", "Album", "Twin");
        let c = fx.track(src, "Collection/c.wav", "Band", "Album", "Twin");
        // A missing row's path is taken too, though its file is gone.
        let gone = fx.row(
            src,
            &fx.path("Collection/Band/Album/Other.wav"),
            "x",
            "y",
            "z",
        );
        lock(&fx.db)
            .execute(
                "UPDATE tracks SET missing_since = '2026-01-01' WHERE id = ?1",
                params![gone],
            )
            .unwrap();
        let d = fx.track(src, "Collection/d.wav", "Band", "Album", "Other");

        let plan = fx.plan(src);
        assert_eq!(
            targets(&plan),
            vec![
                (
                    a,
                    "Band/Album/Song (2).wav".into(),
                    Some(Conflict::TargetExists {
                        wanted: "Band/Album/Song.wav".into()
                    })
                ),
                (b, "Band/Album/Twin.wav".into(), None),
                (
                    c,
                    "Band/Album/Twin (2).wav".into(),
                    Some(Conflict::DuplicateTarget {
                        wanted: "Band/Album/Twin.wav".into(),
                        other_track_id: b
                    })
                ),
                (
                    d,
                    "Band/Album/Other (2).wav".into(),
                    Some(Conflict::TargetExists {
                        wanted: "Band/Album/Other.wav".into()
                    })
                ),
            ]
        );
        let summary = plan.summary();
        assert_eq!((summary.moves, summary.renamed, summary.skipped), (4, 3, 0));
        assert_eq!(summary.conflicts.len(), 3);
        assert_eq!(summary.sample.len(), 4);

        // Applied as planned; the stranger's file is untouched.
        assert_eq!(fx.apply(&plan).moved, 4);
        assert_eq!(fx.rel_path(c), "Band/Album/Twin (2).wav");
        assert_eq!(
            fs::read(fx.path("Collection/Band/Album/Song.wav")).unwrap(),
            b"not ours"
        );
    }

    #[test]
    fn two_tracks_wanting_one_name_collide_regardless_of_case() {
        let fx = Fixture::new("case");
        let src = fx.source("Collection");
        let a = fx.track(src, "Collection/a.wav", "Band", "Album", "Song");
        let b = fx.track(src, "Collection/b.wav", "band", "album", "song");
        let plan = fx.plan(src);
        assert_eq!(plan.ops[0].op.track_id(), a);
        assert_eq!(plan.ops[1].op.track_id(), b);
        assert_eq!(plan.ops[1].op.to().rel_path, "band/album/song (2).wav");
        assert!(matches!(
            plan.ops[1].conflict,
            Some(Conflict::DuplicateTarget { other_track_id, .. }) if other_track_id == a
        ));
    }

    #[test]
    fn a_path_vacated_earlier_in_the_plan_is_free() {
        let fx = Fixture::new("vacated");
        let src = fx.source("Collection");
        // `a` sits where `b` belongs, and moves away first (plans run in
        // path order).
        let a = fx.track(src, "Collection/A/Song.wav", "Band", "Album", "First");
        let b = fx.track(src, "Collection/B/x.wav", "A", "", "Song");
        let plan = plan_organize_source(
            &lock(&fx.db),
            src,
            Some("{artist}/{title}.{ext}".into()),
            "",
        )
        .unwrap();
        assert_eq!(
            targets(&plan),
            vec![
                (a, "Band/First.wav".into(), None),
                (b, "A/Song.wav".into(), None)
            ]
        );
        let summary = fx.apply(&plan);
        assert_eq!(summary.moved, 2);
        assert!(fx.path("Collection/A/Song.wav").is_file());
        assert!(fx.path("Collection/Band/First.wav").is_file());
    }

    #[test]
    fn missing_unreadable_and_spiral_folder_targets_are_skipped() {
        let fx = Fixture::new("blocked");
        // A source around the Spiral folder, whose artist would land a file in it.
        let src = fx.source("Music");
        let gone = fx.row(src, &fx.path("Music/gone.wav"), "Band", "Album", "Gone");
        let inside = fx.track(src, "Music/in.wav", "Spiral Library", "Tracks", "Sneaky");
        let plan = fx.plan(src);
        assert_eq!(
            targets(&plan),
            vec![
                (
                    gone,
                    "Band/Album/Gone.wav".into(),
                    Some(Conflict::SourceMissing)
                ),
                (
                    inside,
                    "Spiral Library/Tracks/Sneaky.wav".into(),
                    Some(Conflict::InsideSpiralFolder)
                ),
            ]
        );
        assert_eq!(plan.summary().skipped, 2);
        let summary = fx.apply(&plan);
        assert_eq!(summary, ApplySummary::default());
        assert!(fx.path("Music/in.wav").is_file());
    }

    #[test]
    fn hidden_targets_are_skipped_since_walks_skip_them() {
        let fx = Fixture::new("hidden");
        let src = fx.source("Collection");
        let id = fx.track(src, "Collection/a.wav", "Band", "Album", ".hack");
        let plan = fx.plan(src);
        assert_eq!(
            targets(&plan),
            vec![(
                id,
                "Band/Album/.hack.wav".into(),
                Some(Conflict::HiddenTarget)
            )]
        );
        assert_eq!(fx.apply(&plan), ApplySummary::default());
        assert_eq!(fx.rel_path(id), "a.wav");
    }

    #[test]
    fn an_unreachable_source_cannot_be_planned() {
        let fx = Fixture::new("offline");
        let src = fx.source("Collection");
        fx.track(src, "Collection/a.wav", "Band", "Album", "Song");
        fs::rename(fx.path("Collection"), fx.path("Unplugged")).unwrap();
        assert!(plan_organize_source(&lock(&fx.db), src, None, FORMAT).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn an_unreadable_file_is_skipped() {
        use std::os::unix::fs::PermissionsExt;
        let fx = Fixture::new("unreadable");
        let src = fx.source("Collection");
        let id = fx.track(src, "Collection/locked.wav", "Band", "Album", "Song");
        let path = fx.path("Collection/locked.wav");
        fs::set_permissions(&path, fs::Permissions::from_mode(0o000)).unwrap();
        if fs::File::open(&path).is_ok() {
            return; // Running as root: permissions don't apply.
        }
        let plan = fx.plan(src);
        assert_eq!(plan.ops[0].op.track_id(), id);
        assert!(matches!(
            plan.ops[0].conflict,
            Some(Conflict::SourceUnreadable { .. })
        ));
        fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
    }

    #[test]
    fn other_and_unknown_sources_cannot_be_planned() {
        let fx = Fixture::new("other");
        let conn = lock(&fx.db);
        assert!(plan_organize_source(&conn, sources::OTHER_SOURCE_ID, None, FORMAT).is_err());
        assert!(plan_organize_source(&conn, 99, None, FORMAT).is_err());
    }

    #[test]
    fn apply_moves_files_sidecars_and_rows_then_prunes_and_finishes() {
        let fx = Fixture::new("apply");
        let src = fx.source("Collection");
        let a = fx.track(src, "Collection/old/deep/a.wav", "Band", "Album", "Song");
        fs::write(fx.path("Collection/old/deep/a.lrc"), "[00:01.00] hi").unwrap();
        // Not emptied: a file of the user's stays, and so does its folder.
        let b = fx.track(src, "Collection/keep/b.wav", "Band", "Album", "Other");
        fs::write(fx.path("Collection/keep/cover.jpg"), b"jpg").unwrap();

        let mut plan = fx.plan(src);
        plan.finish = Some(Finish::OrganizeSource {
            source_id: src,
            path_format: Some(FORMAT.into()),
        });
        let mut progress = Vec::new();
        let summary = apply(&fx.db, &fx.ctx(), &plan, |p| progress.push(p)).unwrap();

        assert_eq!(summary.moved, 2);
        assert_eq!(progress.last(), Some(&Progress { done: 2, total: 2 }));
        assert_eq!(progress.len(), 3);
        assert_eq!(fx.rel_path(a), "Band/Album/Song.wav");
        assert_eq!(fx.rel_path(b), "Band/Album/Other.wav");
        assert!(fx.path("Collection/Band/Album/Song.wav").is_file());
        assert!(fx.path("Collection/Band/Album/Song.lrc").is_file());
        assert!(
            !fx.path("Collection/old").exists(),
            "emptied folders are pruned"
        );
        assert!(fx.path("Collection/keep/cover.jpg").is_file());
        assert!(fx.path("Collection").is_dir(), "the root itself stays");
        assert!(!fx.ctx().journal.exists());
        let source = sources::get_source(&lock(&fx.db), src).unwrap().unwrap();
        assert!(source.auto_organize);
        assert_eq!(source.path_format.as_deref(), Some(FORMAT));

        // Organizing again finds everything in place.
        let again = fx.plan(src);
        assert!(again.ops.is_empty());
        assert_eq!(again.unchanged, 2);
    }

    #[test]
    fn a_target_taken_after_planning_gets_the_next_free_name() {
        let fx = Fixture::new("late");
        let src = fx.source("Collection");
        let a = fx.track(src, "Collection/a.wav", "Band", "Album", "Song");
        let plan = fx.plan(src);
        fs::create_dir_all(fx.path("Collection/Band/Album")).unwrap();
        fs::write(fx.path("Collection/Band/Album/Song.wav"), b"late").unwrap();
        assert_eq!(fx.apply(&plan).moved, 1);
        assert_eq!(fx.rel_path(a), "Band/Album/Song (2).wav");
        assert_eq!(
            fs::read(fx.path("Collection/Band/Album/Song.wav")).unwrap(),
            b"late"
        );
    }

    #[test]
    fn a_file_gone_since_planning_fails_its_step_only() {
        let fx = Fixture::new("gone");
        let src = fx.source("Collection");
        let a = fx.track(src, "Collection/a.wav", "Band", "Album", "A");
        let b = fx.track(src, "Collection/b.wav", "Band", "Album", "B");
        let plan = fx.plan(src);
        fs::remove_file(fx.path("Collection/a.wav")).unwrap();
        let summary = fx.apply(&plan);
        assert_eq!((summary.moved, summary.failed), (1, 1));
        assert_eq!(fx.rel_path(a), "a.wav");
        assert_eq!(fx.rel_path(b), "Band/Album/B.wav");
    }

    #[test]
    fn the_default_source_is_organized_inside_the_spiral_folder() {
        let fx = Fixture::new("default");
        let id = fx.track(
            DEFAULT_SOURCE_ID,
            "Music/Spiral Library/Tracks/x.wav",
            "Band",
            "Album",
            "Song",
        );
        let plan = fx.plan(DEFAULT_SOURCE_ID);
        assert_eq!(
            targets(&plan),
            vec![(id, "Band/Album/Song.wav".into(), None)]
        );
        fx.apply(&plan);
        assert!(fx.library.join("Tracks/Band/Album/Song.wav").is_file());
    }

    /// Write a journal as a crash would leave it: the plan, then `lines`.
    fn crashed_journal(fx: &Fixture, plan: &FilePlan, lines: &[Entry], torn: bool) {
        let steps: Vec<FileOp> = plan.ops.iter().map(|op| op.op.clone()).collect();
        let mut journal = Journal::create(
            &fx.ctx().journal,
            &Entry::Plan {
                steps,
                roots: plan.roots.clone().into_iter().collect(),
                finish: plan.finish.clone(),
            },
        )
        .unwrap();
        for line in lines {
            journal.append(line).unwrap();
        }
        if torn {
            journal.file.write_all(b"{\"type\":\"do").unwrap();
        }
    }

    #[test]
    fn recovery_rolls_an_interrupted_plan_forward() {
        let fx = Fixture::new("recover");
        let src = fx.source("Collection");
        let done = fx.track(src, "Collection/in/1.wav", "Band", "Album", "One");
        let moved = fx.track(src, "Collection/in/2.wav", "Band", "Album", "Two");
        fs::write(fx.path("Collection/in/2.lrc"), "[00:01.00] two").unwrap();
        let untouched = fx.track(src, "Collection/in/3.wav", "Band", "Album", "Three");
        let mut plan = fx.plan(src);
        plan.finish = Some(Finish::OrganizeSource {
            source_id: src,
            path_format: None,
        });
        let op = |i: usize| plan.ops[i].op.clone();

        // Step 0 finished; step 1's file moved but nothing after it; step 2
        // never started. The crash tore the last line.
        let FileOp::Move { from, to, .. } = op(0);
        fs::create_dir_all(to.path.parent().unwrap()).unwrap();
        fs::rename(&from.path, &to.path).unwrap();
        lock(&fx.db)
            .execute(
                "UPDATE tracks SET rel_path = ?1 WHERE id = ?2",
                params![to.rel_path, done],
            )
            .unwrap();
        let FileOp::Move { from, to: to1, .. } = op(1);
        fs::rename(&from.path, &to1.path).unwrap();
        crashed_journal(
            &fx,
            &plan,
            &[
                Entry::Begin { step: 0, to },
                Entry::Done { step: 0 },
                Entry::Begin {
                    step: 1,
                    to: to1.clone(),
                },
            ],
            true,
        );

        let mut progress = Vec::new();
        let summary = recover(&fx.db, &fx.ctx(), |p| progress.push(p))
            .unwrap()
            .expect("there was a journal");
        assert_eq!(summary.moved, 2);
        assert_eq!(progress.last(), Some(&Progress { done: 2, total: 2 }));
        assert_eq!(fx.rel_path(done), "Band/Album/One.wav");
        assert_eq!(fx.rel_path(moved), "Band/Album/Two.wav");
        assert_eq!(fx.rel_path(untouched), "Band/Album/Three.wav");
        assert!(fx.path("Collection/Band/Album/Two.lrc").is_file());
        assert!(!fx.path("Collection/in").exists());
        assert!(!fx.ctx().journal.exists());
        assert!(
            sources::get_source(&lock(&fx.db), src)
                .unwrap()
                .unwrap()
                .auto_organize
        );

        // Nothing left to recover.
        assert_eq!(recover(&fx.db, &fx.ctx(), |_| {}).unwrap(), None);
    }

    #[test]
    fn recovery_redoes_a_half_finished_copy() {
        let fx = Fixture::new("recover-copy");
        let src = fx.source("Collection");
        let id = fx.track(src, "Collection/a.wav", "Band", "Album", "Song");
        let plan = fx.plan(src);
        let FileOp::Move { from, to, .. } = plan.ops[0].op.clone();
        let original = fs::read(&from.path).unwrap();
        fs::create_dir_all(to.path.parent().unwrap()).unwrap();
        fs::write(&to.path, b"partial").unwrap();
        crashed_journal(
            &fx,
            &plan,
            &[Entry::Begin {
                step: 0,
                to: to.clone(),
            }],
            false,
        );

        recover(&fx.db, &fx.ctx(), |_| {}).unwrap();
        assert_eq!(fx.rel_path(id), to.rel_path);
        assert!(!from.path.exists());
        assert_eq!(fs::read(&to.path).unwrap(), original);
    }

    #[test]
    fn recovery_waits_for_an_unreachable_source() {
        let fx = Fixture::new("recover-offline");
        let src = fx.source("Collection");
        fx.track(src, "Collection/a.wav", "Band", "Album", "Song");
        let plan = fx.plan(src);
        crashed_journal(&fx, &plan, &[], false);
        fs::rename(fx.path("Collection"), fx.path("Unplugged")).unwrap();
        assert!(recover(&fx.db, &fx.ctx(), |_| {}).is_err());
        assert!(fx.ctx().journal.exists(), "kept for the next start");
    }

    #[test]
    fn a_journal_torn_before_its_plan_was_written_is_dropped() {
        let fx = Fixture::new("torn-plan");
        fs::write(fx.ctx().journal, b"{\"type\":\"plan\",\"st").unwrap();
        assert_eq!(recover(&fx.db, &fx.ctx(), |_| {}).unwrap(), None);
        assert!(!fx.ctx().journal.exists());
    }

    #[test]
    fn a_journal_that_cant_be_read_is_kept() {
        let fx = Fixture::new("bad-plan");
        fs::write(fx.ctx().journal, b"{\"type\":\"fromTheFuture\"}\n").unwrap();
        assert!(recover(&fx.db, &fx.ctx(), |_| {}).is_err());
        assert!(fx.ctx().journal.exists());
    }

    #[test]
    fn apply_refuses_while_a_journal_is_unfinished() {
        let fx = Fixture::new("busy");
        let src = fx.source("Collection");
        fx.track(src, "Collection/a.wav", "Band", "Album", "Song");
        let plan = fx.plan(src);
        crashed_journal(&fx, &plan, &[], false);
        assert!(apply(&fx.db, &fx.ctx(), &plan, |_| {}).is_err());
        assert!(fx.path("Collection/a.wav").is_file());
    }

    #[test]
    fn the_watchers_reconcile_of_planned_moves_changes_nothing() {
        let fx = Fixture::new("watch");
        let src = fx.source("Collection");
        let scan = fx.scan_ctx();
        fx.track(src, "Collection/in/a.wav", "Band", "Album", "Song");
        fx.track(src, "Collection/in/b.wav", "Band", "Album", "Other");
        // Index the source as the watcher would have, recording file stats.
        source_scan::reconcile_source(&fx.db, &scan, src, ReconcileScope::All).unwrap();
        let ids_before: Vec<i64> = db_ids(&fx);

        let plan = fx.plan(src);
        let olds: Vec<PathBuf> = plan
            .ops
            .iter()
            .map(|op| op.op.from().path.clone())
            .collect();
        let news: Vec<PathBuf> = plan.ops.iter().map(|op| op.op.to().path.clone()).collect();

        // Reconciles wait for the whole apply, so none sees a file moved
        // before its row.
        let summary = apply(&fx.db, &fx.ctx(), &plan, |p| {
            if p.done > 0 {
                assert!(
                    source_scan::RECONCILE_LOCK.try_lock().is_err(),
                    "reconciles are held off mid-apply"
                );
            }
        })
        .unwrap();
        assert_eq!(summary.moved, 2);

        // What the watcher reports for those moves: both sides of each
        // rename, and the pruned folder.
        let mut paths = olds;
        paths.extend(news);
        paths.push(fx.path("Collection/in"));
        let after =
            source_scan::reconcile_source(&fx.db, &scan, src, ReconcileScope::Paths(&paths))
                .unwrap();
        assert!(!after.changed(), "{after:?}");
        let full = source_scan::reconcile_source(&fx.db, &scan, src, ReconcileScope::All).unwrap();
        assert!(!full.changed(), "{full:?}");
        assert_eq!(db_ids(&fx), ids_before);
    }

    fn db_ids(fx: &Fixture) -> Vec<i64> {
        let conn = lock(&fx.db);
        let mut stmt = conn
            .prepare("SELECT id FROM tracks WHERE missing_since IS NULL ORDER BY id")
            .unwrap();
        let ids = stmt
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<Vec<i64>, _>>()
            .unwrap();
        ids
    }

    #[test]
    fn moves_follow_the_legacy_art_cache() {
        let fx = Fixture::new("art");
        let src = fx.source("Collection");
        let id = fx.track(src, "Collection/a.wav", "Band", "Album", "Song");
        let app_data = fx.path("AppData");
        let old = fx.path("Collection/a.wav");
        let cache = crate::art_cache::art_cache_dir(&app_data);
        fs::create_dir_all(&cache).unwrap();
        let cached = cache.join(format!(
            "{}.jpg",
            crate::art_cache::art_cache_key(&old.to_string_lossy())
        ));
        fs::write(&cached, b"art").unwrap();
        lock(&fx.db)
            .execute(
                "UPDATE tracks SET art_path = ?1 WHERE id = ?2",
                params![cached.to_string_lossy(), id],
            )
            .unwrap();

        let plan = fx.plan(src);
        let ctx = ApplyContext {
            app_data_dir: Some(app_data),
            ..fx.ctx()
        };
        apply(&fx.db, &ctx, &plan, |_| {}).unwrap();
        let art: String = lock(&fx.db)
            .query_row(
                "SELECT art_path FROM tracks WHERE id = ?1",
                params![id],
                |r| r.get(0),
            )
            .unwrap();
        assert_ne!(art, cached.to_string_lossy());
        assert!(Path::new(&art).is_file());
        assert!(!cached.exists());
    }

    #[test]
    fn plan_entries_serialize_for_the_frontend() {
        let op = PlannedOp {
            op: FileOp::Move {
                track_id: 7,
                from: Location {
                    source_id: 3,
                    rel_path: "a.mp3".into(),
                    path: PathBuf::from("/m/a.mp3"),
                },
                to: Location {
                    source_id: 3,
                    rel_path: "B/a.mp3".into(),
                    path: PathBuf::from("/m/B/a.mp3"),
                },
            },
            conflict: Some(Conflict::DuplicateTarget {
                wanted: "B/a.mp3".into(),
                other_track_id: 6,
            }),
        };
        let json = serde_json::to_value(&op).unwrap();
        assert_eq!(json["op"]["kind"], "move");
        assert_eq!(json["op"]["trackId"], 7);
        assert_eq!(json["op"]["to"]["relPath"], "B/a.mp3");
        assert_eq!(json["conflict"]["kind"], "duplicateTarget");
        assert_eq!(json["conflict"]["otherTrackId"], 6);
    }
}
