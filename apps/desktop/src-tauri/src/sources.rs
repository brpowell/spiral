//! Library sources: the folders tracks live in.
//!
//! Every track belongs to a source, and stores its path relative to that
//! source's root, so moving a folder (or the whole Spiral folder) is a single
//! root update. Sources are the folders the user chose, each with its own
//! `auto_organize` flag and optional `path_format` (NULL inherits the global
//! format). There may be none at all. One row is built in:
//! - Other ([`OTHER_SOURCE_ID`]) has no root. It holds loose files referenced
//!   one at a time, by absolute path, and is never organized. It is a bucket,
//!   not a folder the user chose, and can't be removed.
//!
//! A source may sit inside the Spiral folder (onboarding's `Tracks`, see
//! [`create_managed_source`]). Its root is then stored relative to the Spiral
//! folder, so it follows the database when the Spiral folder moves. The
//! Spiral folder itself and its data (database, artwork, packs) are never a
//! source, and walks of a source around them skip them.

use crate::path_scope::path_forms;
use crate::settings::{self, LibrarySettingsResponse};
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

pub const OTHER_SOURCE_ID: i64 = 2;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub id: i64,
    pub name: String,
    /// The folder the source's files live in, as an absolute path. `None` for
    /// Other, and for a source inside the Spiral folder when the Spiral folder
    /// isn't known (in-memory test databases).
    pub root_path: Option<String>,
    pub auto_organize: bool,
    /// Path format for organizing this source; `None` inherits the global one.
    pub path_format: Option<String>,
    /// New imports are copied into this source.
    pub import_target: bool,
    pub created_at: String,
}

/// The library folders sources are checked and walked against.
#[derive(Debug, Clone)]
pub struct LibraryRoots {
    /// The Spiral folder: database, artwork and packs.
    pub library_root: PathBuf,
    /// Every source's folder, so a walk of one source can skip another nested
    /// inside it. Empty until [`LibraryRoots::with_sources`].
    pub source_roots: Vec<PathBuf>,
}

impl LibraryRoots {
    pub fn for_library_root(library_root: &Path) -> Self {
        Self {
            library_root: library_root.to_path_buf(),
            source_roots: Vec::new(),
        }
    }

    pub fn from_settings(library: &LibrarySettingsResponse) -> Self {
        Self::for_library_root(Path::new(&library.library_root))
    }

    /// The same roots, knowing every source's folder in `conn`.
    pub fn with_sources(mut self, conn: &Connection) -> Result<Self, rusqlite::Error> {
        self.source_roots = source_roots(conn)?
            .into_iter()
            .map(|(_, root)| root)
            .collect();
        Ok(self)
    }
}

/// What the Spiral folder holds besides sources: the database file and the
/// artwork and packs folders. No source may be one of them or inside one,
/// and walks never enter them.
pub fn spiral_data_paths(library_root: &Path) -> Vec<PathBuf> {
    vec![
        settings::database_path_for_root(library_root),
        settings::artwork_folder_for_root(library_root),
        library_root.join(crate::packs::LIBRARY_PACKS_DIR_NAME),
    ]
}

/// True when `path` is the Spiral folder's database, artwork or packs, or
/// inside them.
pub fn is_spiral_data(path: &Path, library_root: &Path) -> bool {
    spiral_data_paths(library_root)
        .iter()
        .any(|data| is_within(path, data))
}

/// Record which Spiral folder this connection's database belongs to, so roots
/// stored relative to it can be resolved without asking settings. Kept in a
/// TEMP table: it is per connection and never written to the database file.
/// `db::open` calls this with the database's folder.
pub fn attach_spiral_folder(conn: &Connection, folder: &Path) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "CREATE TEMP TABLE IF NOT EXISTS spiral_folder (path TEXT NOT NULL);
         DELETE FROM temp.spiral_folder;",
    )?;
    conn.execute(
        "INSERT INTO temp.spiral_folder (path) VALUES (?1)",
        params![folder.to_string_lossy()],
    )?;
    Ok(())
}

/// The Spiral folder recorded by [`attach_spiral_folder`], if any.
pub fn spiral_folder(conn: &Connection) -> Result<Option<PathBuf>, rusqlite::Error> {
    let attached: bool = conn.query_row(
        "SELECT COUNT(*) > 0 FROM sqlite_temp_master WHERE type = 'table' AND name = 'spiral_folder'",
        [],
        |row| row.get(0),
    )?;
    if !attached {
        return Ok(None);
    }
    conn.query_row("SELECT path FROM temp.spiral_folder", [], |row| {
        row.get::<_, String>(0)
    })
    .optional()
    .map(|path| path.map(PathBuf::from))
}

/// `path` relative to `root`, with `/` separators, comparing each as given
/// and with symlinks resolved. `None` when `path` is not strictly inside it.
fn relative_to(path: &Path, root: &Path) -> Option<String> {
    let roots = path_forms(root);
    let rel = path_forms(path).into_iter().find_map(|p| {
        roots
            .iter()
            .find_map(|r| p.strip_prefix(r).ok().map(Path::to_path_buf))
    })?;
    let parts: Vec<String> = rel
        .components()
        .map(|c| c.as_os_str().to_string_lossy().into_owned())
        .collect();
    (!parts.is_empty()).then(|| parts.join("/"))
}

/// `root` joined with a stored `/`-separated relative path, using the
/// platform's separators.
pub fn join_rel_path(root: &Path, rel_path: &str) -> PathBuf {
    rel_path
        .split('/')
        .filter(|part| !part.is_empty())
        .fold(root.to_path_buf(), |path, part| path.join(part))
}

/// A stored `root_path` as an absolute folder: as it is when absolute, else
/// relative to the Spiral folder (`None` when that isn't known).
fn resolve_stored_root(stored: &str, spiral: Option<&Path>) -> Option<PathBuf> {
    if Path::new(stored).is_absolute() {
        Some(PathBuf::from(stored))
    } else {
        spiral.map(|folder| join_rel_path(folder, stored))
    }
}

/// What to store as `root_path` for `root`: relative to the Spiral folder
/// when it is inside it, so it follows the Spiral folder, else absolute.
fn stored_root(conn: &Connection, root: &Path) -> Result<String, String> {
    let spiral = spiral_folder(conn).map_err(|e| e.to_string())?;
    Ok(spiral
        .and_then(|folder| relative_to(root, &folder))
        .unwrap_or_else(|| root.to_string_lossy().into_owned()))
}

/// True when `root_path` is stored relative to the Spiral folder.
pub fn is_spiral_relative(root_path: &str) -> bool {
    !Path::new(root_path).is_absolute()
}

/// Turns tracks' stored `(source_id, rel_path)` into absolute paths and back.
/// Every read of a track's file path goes through [`SourceRoots::resolve`].
/// Load it once per query or batch; it holds a copy of the roots.
#[derive(Debug, Clone, Default)]
pub struct SourceRoots {
    roots: HashMap<i64, PathBuf>,
    /// The Spiral folder, when known: its data is never located in a source.
    spiral: Option<PathBuf>,
}

impl SourceRoots {
    pub fn load(conn: &Connection) -> Result<Self, rusqlite::Error> {
        let spiral = spiral_folder(conn)?;
        let mut roots = HashMap::new();
        let mut stmt =
            conn.prepare("SELECT id, root_path FROM sources WHERE root_path IS NOT NULL")?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })?;
        for row in rows {
            let (id, stored) = row?;
            if let Some(root) = resolve_stored_root(&stored, spiral.as_deref()) {
                roots.insert(id, root);
            }
        }
        Ok(Self { roots, spiral })
    }

    /// The source's root folder. `None` for Other, and for a source inside the
    /// Spiral folder when the Spiral folder isn't known.
    pub fn root(&self, source_id: i64) -> Option<&Path> {
        self.roots.get(&source_id).map(PathBuf::as_path)
    }

    /// Every source's root, by id.
    pub fn all(&self) -> Vec<(i64, PathBuf)> {
        let mut all: Vec<(i64, PathBuf)> = self
            .roots
            .iter()
            .map(|(id, root)| (*id, root.clone()))
            .collect();
        all.sort_by_key(|(id, _)| *id);
        all
    }

    /// The absolute path of a track stored as `rel_path` in `source_id`. An
    /// absolute `rel_path` (Other's tracks) is returned as it is.
    pub fn resolve(&self, source_id: i64, rel_path: &str) -> String {
        match self.root(source_id) {
            Some(root) if !Path::new(rel_path).is_absolute() => {
                join_rel_path(root, rel_path).to_string_lossy().into_owned()
            }
            _ => rel_path.to_string(),
        }
    }

    /// What to store as `rel_path` for the file at `path` in `source_id`:
    /// relative to the source's root, or absolute for Other (and for a source
    /// whose root isn't known). Fails when the file is not inside the root.
    pub fn relative_path(&self, source_id: i64, path: &Path) -> Result<String, String> {
        match self.root(source_id) {
            Some(root) => relative_to(path, root).ok_or_else(|| {
                format!(
                    "{} is not inside the source folder {}",
                    path.display(),
                    root.display()
                )
            }),
            None => Ok(path.to_string_lossy().into_owned()),
        }
    }

    /// Where to store a file at `path`: in `preferred` if it is inside that
    /// source's folder, else in the source with the deepest root containing
    /// it, else in Other by absolute path. The Spiral folder's data never
    /// belongs to a source.
    pub fn locate(&self, path: &Path, preferred: i64) -> (i64, String) {
        let other = || (OTHER_SOURCE_ID, path.to_string_lossy().into_owned());
        if self
            .spiral
            .as_deref()
            .is_some_and(|folder| is_spiral_data(path, folder))
        {
            return other();
        }
        if let Ok(rel) = self.relative_path(preferred, path) {
            if preferred != OTHER_SOURCE_ID || self.deepest(path).is_none() {
                return (preferred, rel);
            }
        }
        self.deepest(path).unwrap_or_else(other)
    }

    fn deepest(&self, path: &Path) -> Option<(i64, String)> {
        self.roots
            .iter()
            .filter_map(|(id, root)| {
                relative_to(path, root).map(|rel| (root.components().count(), *id, rel))
            })
            .max_by_key(|(depth, _, _)| *depth)
            .map(|(_, id, rel)| (id, rel))
    }

    /// Every `(source_id, rel_path)` a track at `path` could be stored as:
    /// relative to each source root containing it, and absolute (Other).
    pub fn candidates(&self, path: &Path) -> Vec<(i64, String)> {
        let mut out: Vec<(i64, String)> = self
            .roots
            .iter()
            .filter_map(|(id, root)| relative_to(path, root).map(|rel| (*id, rel)))
            .collect();
        out.push((OTHER_SOURCE_ID, path.to_string_lossy().into_owned()));
        out
    }
}

const SOURCE_SELECT: &str =
    "SELECT id, name, root_path, auto_organize, path_format, import_target, created_at FROM sources";

fn map_source_row(row: &Row<'_>) -> rusqlite::Result<Source> {
    Ok(Source {
        id: row.get(0)?,
        name: row.get(1)?,
        root_path: row.get(2)?,
        auto_organize: row.get(3)?,
        path_format: row.get(4)?,
        import_target: row.get(5)?,
        created_at: row.get(6)?,
    })
}

/// Report the root as an absolute path; it may be stored relative to the
/// Spiral folder.
fn with_resolved_root(mut source: Source, roots: &SourceRoots) -> Source {
    source.root_path = roots
        .root(source.id)
        .map(|root| root.to_string_lossy().into_owned());
    source
}

pub fn list_sources(conn: &Connection) -> Result<Vec<Source>, rusqlite::Error> {
    let roots = SourceRoots::load(conn)?;
    let mut stmt = conn.prepare(&format!("{SOURCE_SELECT} ORDER BY id"))?;
    let sources = stmt
        .query_map([], map_source_row)?
        .map(|s| s.map(|s| with_resolved_root(s, &roots)))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(sources)
}

pub fn get_source(conn: &Connection, id: i64) -> Result<Option<Source>, rusqlite::Error> {
    let source = conn
        .query_row(
            &format!("{SOURCE_SELECT} WHERE id = ?1"),
            params![id],
            map_source_row,
        )
        .optional()?;
    match source {
        Some(source) => Ok(Some(with_resolved_root(source, &SourceRoots::load(conn)?))),
        None => Ok(None),
    }
}

/// Every source's root as stored, by id: relative to the Spiral folder for a
/// source inside it (see [`is_spiral_relative`]), else absolute.
pub fn stored_roots(conn: &Connection) -> Result<Vec<(i64, String)>, rusqlite::Error> {
    let mut stmt =
        conn.prepare("SELECT id, root_path FROM sources WHERE root_path IS NOT NULL ORDER BY id")?;
    let rows = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Every source's absolute root (every source but Other), by id.
pub fn source_roots(conn: &Connection) -> Result<Vec<(i64, PathBuf)>, rusqlite::Error> {
    Ok(SourceRoots::load(conn)?.all())
}

/// True when `path` is `root` or inside it, comparing each as given and with
/// symlinks resolved (the same forms `path_scope` checks).
pub fn is_within(path: &Path, root: &Path) -> bool {
    let roots = path_forms(root);
    path_forms(path)
        .iter()
        .any(|p| roots.iter().any(|r| p.starts_with(r)))
}

fn overlaps(a: &Path, b: &Path) -> bool {
    is_within(a, b) || is_within(b, a)
}

fn same_folder(a: &Path, b: &Path) -> bool {
    is_within(a, b) && is_within(b, a)
}

/// Resolves paths to sources without re-reading the roots each time.
struct Resolver<'a> {
    roots: &'a LibraryRoots,
    sources: Vec<(i64, PathBuf)>,
}

impl<'a> Resolver<'a> {
    fn new(conn: &Connection, roots: &'a LibraryRoots) -> Result<Self, rusqlite::Error> {
        Ok(Self {
            roots,
            sources: source_roots(conn)?,
        })
    }

    fn source_for(&self, path: &Path) -> i64 {
        if is_spiral_data(path, &self.roots.library_root) {
            return OTHER_SOURCE_ID;
        }
        self.sources
            .iter()
            .filter(|(_, root)| is_within(path, root))
            .max_by_key(|(_, root)| root.components().count())
            .map_or(OTHER_SOURCE_ID, |(id, _)| *id)
    }
}

/// The source a file at `path` belongs to: the deepest source containing it,
/// else Other. The Spiral folder's data (artwork, packs) is always Other.
pub fn source_for_path(
    conn: &Connection,
    roots: &LibraryRoots,
    path: &Path,
) -> Result<i64, rusqlite::Error> {
    Ok(Resolver::new(conn, roots)?.source_for(path))
}

/// Move Other's tracks whose files fall under a source into it, storing their
/// paths relative to its root. Run when the database opens and when a source
/// is added; a no-op once they are assigned. Returns how many moved.
pub fn assign_other_tracks(
    conn: &Connection,
    roots: &LibraryRoots,
) -> Result<usize, rusqlite::Error> {
    let resolver = Resolver::new(conn, roots)?;
    let source_roots = SourceRoots::load(conn)?;
    let tracks: Vec<(i64, String)> = conn
        .prepare("SELECT id, rel_path FROM tracks WHERE source_id = ?1")?
        .query_map(params![OTHER_SOURCE_ID], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })?
        .collect::<Result<_, _>>()?;

    let mut moved = 0;
    for (id, file_path) in tracks {
        let path = Path::new(&file_path);
        let source_id = resolver.source_for(path);
        if source_id == OTHER_SOURCE_ID {
            continue;
        }
        let Ok(rel_path) = source_roots.relative_path(source_id, path) else {
            continue;
        };
        conn.execute(
            "UPDATE tracks SET source_id = ?1, rel_path = ?2 WHERE id = ?3",
            params![source_id, rel_path, id],
        )?;
        moved += 1;
    }
    Ok(moved)
}

/// Error prefixes, so the UI can explain them. The first three come from
/// [`validate_source_root`].
pub const SOURCE_NOT_FOLDER: &str = "source_not_folder";
/// The folder is the Spiral folder, or its database, artwork or packs.
pub const SOURCE_SPIRAL_DATA: &str = "source_spiral_data";
pub const SOURCE_OVERLAP: &str = "source_overlap";
/// There is no source to copy a file into: no import target is set (for an
/// import, or a replace or convert of one of Other's tracks).
pub const NO_SOURCE: &str = "no_source";
/// The source's folder isn't reachable (an unplugged drive), so nothing is
/// written to it.
pub const SOURCE_UNAVAILABLE: &str = "source_unavailable";

/// Check a folder can become a source: an absolute, existing folder that
/// neither equals, contains nor sits inside another source's root. It may sit
/// inside the Spiral folder, but may not be the Spiral folder itself or its
/// database, artwork or packs (or inside those). It may contain the Spiral
/// folder (e.g. `~/Music` around `~/Music/Spiral`); walks skip its data.
/// `exclude` skips one source's own root, for moving that source.
pub fn validate_source_root(
    conn: &Connection,
    roots: &LibraryRoots,
    root: &Path,
    exclude: Option<i64>,
) -> Result<(), String> {
    if path_forms(root).is_empty() {
        return Err(format!(
            "{SOURCE_NOT_FOLDER}: {} is not an absolute folder path",
            root.display()
        ));
    }
    if !root.is_dir() {
        return Err(format!(
            "{SOURCE_NOT_FOLDER}: {} is not a folder",
            root.display()
        ));
    }
    if same_folder(root, &roots.library_root) || is_spiral_data(root, &roots.library_root) {
        return Err(format!(
            "{SOURCE_SPIRAL_DATA}: {} is the Spiral folder or holds its data",
            root.display()
        ));
    }
    let existing = source_roots(conn).map_err(|e| e.to_string())?;
    if let Some((_, other)) = existing
        .iter()
        .find(|(id, other)| Some(*id) != exclude && overlaps(root, other))
    {
        return Err(format!(
            "{SOURCE_OVERLAP}: {} overlaps the source folder {}",
            root.display(),
            other.display()
        ));
    }
    Ok(())
}

fn not_found(id: i64) -> String {
    format!("Source {id} not found")
}

fn get_source_or_err(conn: &Connection, id: i64) -> Result<Source, String> {
    get_source(conn, id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| not_found(id))
}

/// Add a folder as a source, with organize off. Other's tracks already under
/// it move to the new source. `name` defaults to the folder name.
pub fn add_source(
    conn: &Connection,
    roots: &LibraryRoots,
    root_path: &str,
    name: Option<&str>,
) -> Result<Source, String> {
    let root = PathBuf::from(root_path.trim());
    validate_source_root(conn, roots, &root, None)?;
    let name = name
        .map(str::trim)
        .filter(|n| !n.is_empty())
        .map(str::to_string)
        .or_else(|| root.file_name().map(|n| n.to_string_lossy().into_owned()))
        .unwrap_or_else(|| root.to_string_lossy().into_owned());

    let stored = stored_root(conn, &root)?;
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO sources (name, root_path, created_at) VALUES (?1, ?2, ?3)",
        params![name, stored, Utc::now().to_rfc3339()],
    )
    .map_err(|e| e.to_string())?;
    let id = tx.last_insert_rowid();
    assign_other_tracks(&tx, roots).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    get_source_or_err(conn, id)
}

/// The source whose folder is the Spiral folder's `Tracks`, if any.
pub fn managed_source_id(
    conn: &Connection,
    roots: &LibraryRoots,
) -> Result<Option<i64>, rusqlite::Error> {
    let tracks = settings::media_folder_for_root(&roots.library_root);
    Ok(source_roots(conn)?
        .into_iter()
        .find(|(_, root)| same_folder(root, &tracks))
        .map(|(id, _)| id))
}

/// Let Spiral manage the user's music: create `Tracks` in the Spiral folder
/// if needed, add it as an organized source, and make it the import target
/// when none is set. A no-op returning the existing source when `Tracks` is
/// already one.
pub fn create_managed_source(conn: &Connection, roots: &LibraryRoots) -> Result<Source, String> {
    if let Some(id) = managed_source_id(conn, roots).map_err(|e| e.to_string())? {
        return get_source_or_err(conn, id);
    }
    let tracks = settings::media_folder_for_root(&roots.library_root);
    std::fs::create_dir_all(&tracks)
        .map_err(|e| format!("failed to create {}: {e}", tracks.display()))?;
    let source = add_source(conn, roots, &tracks.to_string_lossy(), None)?;
    let source = set_source_organize(conn, source.id, true)?;
    if import_source_id(conn).map_err(|e| e.to_string())?.is_none() {
        return set_import_source(conn, source.id);
    }
    Ok(source)
}

/// Remove a source and its tracks' rows (with their play history, playlist
/// entries and lyrics). The files stay where they are. Any source but Other
/// can be removed. If it was the import target, the source with the lowest id
/// whose folder is reachable becomes the target, or none does. Returns how
/// many track rows were removed.
pub fn remove_source(conn: &Connection, id: i64) -> Result<usize, String> {
    if id == OTHER_SOURCE_ID {
        return Err("Other can't be removed".to_string());
    }
    let source = get_source_or_err(conn, id)?;
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let removed = tx
        .execute("DELETE FROM tracks WHERE source_id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM sources WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    if source.import_target {
        let next = source_roots(&tx)
            .map_err(|e| e.to_string())?
            .into_iter()
            .find(|(_, root)| root.is_dir());
        if let Some((next, _)) = next {
            tx.execute(
                "UPDATE sources SET import_target = 1 WHERE id = ?1",
                params![next],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(removed)
}

/// Point a source at the folder its files moved to. Tracks store paths
/// relative to the root, so only the source row changes; rescan afterwards to
/// pick up what differs.
pub fn set_source_root(
    conn: &Connection,
    roots: &LibraryRoots,
    id: i64,
    new_root: &str,
) -> Result<Source, String> {
    refuse_other(id, "be moved")?;
    get_source_or_err(conn, id)?;
    let new_root = PathBuf::from(new_root.trim());
    validate_source_root(conn, roots, &new_root, Some(id))?;
    conn.execute(
        "UPDATE sources SET root_path = ?1 WHERE id = ?2",
        params![stored_root(conn, &new_root)?, id],
    )
    .map_err(|e| e.to_string())?;
    get_source_or_err(conn, id)
}

fn refuse_other(id: i64, what: &str) -> Result<(), String> {
    if id == OTHER_SOURCE_ID {
        return Err(format!("Other has no folder, so it can't {what}"));
    }
    Ok(())
}

fn update_source(
    conn: &Connection,
    id: i64,
    sql: &str,
    value: impl rusqlite::ToSql,
) -> Result<Source, String> {
    let changed = conn
        .execute(sql, params![value, id])
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err(not_found(id));
    }
    get_source_or_err(conn, id)
}

/// Turn organizing on or off for a source. Moving existing files to match is
/// not done here; that goes through the organize planner.
pub fn set_source_organize(
    conn: &Connection,
    id: i64,
    auto_organize: bool,
) -> Result<Source, String> {
    refuse_other(id, "be organized")?;
    update_source(
        conn,
        id,
        "UPDATE sources SET auto_organize = ?1 WHERE id = ?2",
        auto_organize,
    )
}

/// Set a source's own path format, or `None` (or blank) to inherit the global one.
pub fn set_source_path_format(
    conn: &Connection,
    id: i64,
    path_format: Option<String>,
) -> Result<Source, String> {
    refuse_other(id, "have a path format")?;
    let path_format = path_format
        .map(|f| f.trim().to_string())
        .filter(|f| !f.is_empty());
    update_source(
        conn,
        id,
        "UPDATE sources SET path_format = ?1 WHERE id = ?2",
        path_format,
    )
}

/// Make `id` the source new imports are copied into.
pub fn set_import_source(conn: &Connection, id: i64) -> Result<Source, String> {
    refuse_other(id, "receive imports")?;
    get_source_or_err(conn, id)?;
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE sources SET import_target = 0 WHERE import_target = 1",
        [],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE sources SET import_target = 1 WHERE id = ?1",
        params![id],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    get_source_or_err(conn, id)
}

/// The source new imports are copied into, if one is set.
pub fn import_source_id(conn: &Connection) -> Result<Option<i64>, rusqlite::Error> {
    conn.query_row(
        "SELECT id FROM sources WHERE import_target = 1",
        [],
        |row| row.get(0),
    )
    .optional()
}

/// Where copy imports go, for the UI.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportTarget {
    /// The import target, if one is set.
    pub source: Option<Source>,
    /// True when a copy import can run now: the target is set and its folder
    /// is reachable. "Keep files where they are" imports work regardless.
    pub copy_available: bool,
}

pub fn import_target(conn: &Connection) -> Result<ImportTarget, rusqlite::Error> {
    let source = match import_source_id(conn)? {
        Some(id) => get_source(conn, id)?,
        None => None,
    };
    let copy_available = source
        .as_ref()
        .and_then(|s| s.root_path.as_deref())
        .is_some_and(|root| Path::new(root).is_dir());
    Ok(ImportTarget {
        source,
        copy_available,
    })
}

/// The path format a source's files are organized with: its own, else
/// Spiral's built-in [`library_organize::default_organize_path_format`]
/// (there is no user-wide default). `None` when organizing is off for it
/// (always for Other). Import, replace, convert and tag edits use this, as
/// does the organize planner.
pub fn organize_settings(
    conn: &Connection,
    source_id: i64,
) -> Result<Option<String>, rusqlite::Error> {
    if source_id == OTHER_SOURCE_ID {
        return Ok(None);
    }
    let row: Option<(bool, Option<String>)> = conn
        .query_row(
            "SELECT auto_organize, path_format FROM sources WHERE id = ?1",
            params![source_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    Ok(match row {
        Some((true, format)) => Some(
            format
                .filter(|f| !f.trim().is_empty())
                .unwrap_or_else(crate::library_organize::default_organize_path_format),
        ),
        _ => None,
    })
}

/// A source's folder and organize format, for writing a file into it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WriteTarget {
    pub source_id: i64,
    pub root: PathBuf,
    /// `Some` when files are organized: the effective path format.
    pub path_format: Option<String>,
}

/// Where a new file for `source_id` goes. Other has no folder, so its files
/// go to the import source instead, and fail with [`NO_SOURCE`] when there is
/// none. Fails with [`SOURCE_UNAVAILABLE`] when the folder isn't reachable,
/// so nothing is written to (or created on) a drive that isn't there.
pub fn write_target(conn: &Connection, source_id: i64) -> Result<WriteTarget, String> {
    let source_id = if source_id == OTHER_SOURCE_ID {
        import_source_id(conn)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("{NO_SOURCE}: there is no source folder to copy files into"))?
    } else {
        source_id
    };
    let roots = SourceRoots::load(conn).map_err(|e| e.to_string())?;
    let root = roots
        .root(source_id)
        .ok_or_else(|| format!("{NO_SOURCE}: source {source_id} has no folder"))?
        .to_path_buf();
    if !root.is_dir() {
        return Err(format!(
            "{SOURCE_UNAVAILABLE}: the folder {} is not available",
            root.display()
        ));
    }
    let path_format = organize_settings(conn, source_id).map_err(|e| e.to_string())?;
    Ok(WriteTarget {
        source_id,
        root,
        path_format,
    })
}

/// True when a walk or watcher of the source rooted at `source_root` must
/// skip `path`: it is the Spiral folder's database, artwork or packs (a
/// source may contain the Spiral folder), or inside another source's root
/// nested in this one (from before sources inside the Spiral folder existed,
/// a source around the Spiral folder may contain `Tracks`). Needs
/// [`LibraryRoots::with_sources`] for the second part.
pub fn is_outside_source_walk(path: &Path, source_root: &Path, roots: &LibraryRoots) -> bool {
    is_spiral_data(path, &roots.library_root)
        || roots.source_roots.iter().any(|other| {
            !is_within(source_root, other)
                && is_within(other, source_root)
                && is_within(path, other)
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db_migrations;

    /// An in-memory database: no Spiral folder is known.
    fn mem_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        db_migrations::run(&conn, None).unwrap();
        conn
    }

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(label: &str) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "spiral-sources-{label}-{}-{}",
                std::process::id(),
                Utc::now().timestamp_nanos_opt().unwrap_or_default()
            ));
            std::fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }

        fn dir(&self, rel: &str) -> PathBuf {
            let path = self.0.join(rel);
            std::fs::create_dir_all(&path).unwrap();
            path
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn roots(tmp: &TempDir) -> LibraryRoots {
        let library = tmp.dir("Music/Spiral Library");
        tmp.dir("Music/Spiral Library/Tracks");
        LibraryRoots::for_library_root(&library)
    }

    /// The library database in the Spiral folder of `tmp`, opened as the app does.
    fn library(tmp: &TempDir) -> (Connection, LibraryRoots) {
        let roots = roots(tmp);
        let conn = crate::db::open(&roots.library_root.join("Library.db")).unwrap();
        (conn, roots)
    }

    fn insert_track(conn: &Connection, rel_path: &str, source_id: i64) -> i64 {
        conn.execute(
            "INSERT INTO tracks (title, rel_path, date_added, source_id)
             VALUES ('Song', ?1, '2024-01-01T00:00:00Z', ?2)",
            params![rel_path, source_id],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    fn track_location(conn: &Connection, id: i64) -> (i64, String) {
        conn.query_row(
            "SELECT source_id, rel_path FROM tracks WHERE id = ?1",
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap()
    }

    fn tracks_folder(roots: &LibraryRoots) -> PathBuf {
        settings::media_folder_for_root(&roots.library_root)
    }

    fn add(conn: &Connection, roots: &LibraryRoots, root: &Path) -> Result<Source, String> {
        add_source(conn, roots, &root.to_string_lossy(), None)
    }

    fn s(path: &Path) -> String {
        path.to_string_lossy().into_owned()
    }

    #[test]
    fn a_new_library_has_no_sources_but_other() {
        let tmp = TempDir::new("seed");
        let (conn, _) = library(&tmp);
        let sources = list_sources(&conn).unwrap();
        assert_eq!(sources.len(), 1);
        let other = &sources[0];
        assert_eq!(other.id, OTHER_SOURCE_ID);
        assert!(!other.auto_organize && !other.import_target);
        assert_eq!(other.root_path, None);
        assert_eq!(import_source_id(&conn).unwrap(), None);
        assert_eq!(
            import_target(&conn).unwrap(),
            ImportTarget {
                source: None,
                copy_available: false
            }
        );
    }

    #[test]
    fn schema_protects_other_only() {
        let conn = mem_conn();
        assert!(conn
            .execute(
                "DELETE FROM sources WHERE id = ?1",
                params![OTHER_SOURCE_ID]
            )
            .is_err());
        assert!(conn
            .execute("UPDATE sources SET root_path = '/x' WHERE id = 2", [])
            .is_err());
        // Only Other goes without a root.
        assert!(conn
            .execute(
                "INSERT INTO sources (name, created_at) VALUES ('x', 'now')",
                []
            )
            .is_err());
        conn.execute(
            "INSERT INTO sources (name, root_path, created_at) VALUES ('a', '/a', 'now')",
            [],
        )
        .unwrap();
        let id = conn.last_insert_rowid();
        assert!(conn
            .execute(
                "UPDATE sources SET root_path = NULL WHERE id = ?1",
                params![id]
            )
            .is_err());
        assert!(conn
            .execute("UPDATE sources SET id = 99 WHERE id = ?1", params![id])
            .is_err());
        // Roots are unique, and Other is never organized or imported into.
        assert!(conn
            .execute(
                "INSERT INTO sources (name, root_path, created_at) VALUES ('b', '/a', 'now')",
                [],
            )
            .is_err());
        assert!(conn
            .execute("UPDATE sources SET auto_organize = 1 WHERE id = 2", [])
            .is_err());
        assert!(conn
            .execute("UPDATE sources SET import_target = 1 WHERE id = 2", [])
            .is_err());
        // At most one import target.
        conn.execute(
            "INSERT INTO sources (name, root_path, import_target, created_at)
             VALUES ('c', '/c', 1, 'now')",
            [],
        )
        .unwrap();
        assert!(conn
            .execute(
                "UPDATE sources SET import_target = 1 WHERE id = ?1",
                params![id]
            )
            .is_err());
        // Any source with a root can go, the import target included.
        conn.execute("DELETE FROM sources WHERE root_path IS NOT NULL", [])
            .unwrap();
    }

    #[test]
    fn tracks_require_an_existing_source_and_unique_paths_per_source() {
        let conn = mem_conn();
        let missing = conn.execute(
            "INSERT INTO tracks (title, rel_path, date_added) VALUES ('S', 'a.mp3', 'now')",
            [],
        );
        assert!(missing.is_err());
        let dangling = conn.execute(
            "INSERT INTO tracks (title, rel_path, date_added, source_id) VALUES ('S', 'a.mp3', 'now', 99)",
            [],
        );
        assert!(dangling.is_err());
        conn.execute(
            "INSERT INTO sources (name, root_path, created_at) VALUES ('a', '/a', 'now')",
            [],
        )
        .unwrap();
        let source = conn.last_insert_rowid();
        insert_track(&conn, "a.mp3", source);
        insert_track(&conn, "/x/a.mp3", OTHER_SOURCE_ID);
        let duplicate = conn.execute(
            "INSERT INTO tracks (title, rel_path, date_added, source_id) VALUES ('S', 'a.mp3', 'now', ?1)",
            params![source],
        );
        assert!(duplicate.is_err());
    }

    #[test]
    fn resolver_joins_roots_and_relative_paths() {
        let tmp = TempDir::new("resolve-paths");
        let (conn, roots) = library(&tmp);
        let tracks = create_managed_source(&conn, &roots).unwrap().id;
        let media = tracks_folder(&roots);
        let rock = add(&conn, &roots, &tmp.dir("Collection/Rock")).unwrap();
        let resolver = SourceRoots::load(&conn).unwrap();

        assert_eq!(resolver.root(tracks), Some(media.as_path()));
        assert_eq!(resolver.root(OTHER_SOURCE_ID), None);
        assert_eq!(
            resolver.resolve(tracks, "Artist/Album/a.mp3"),
            s(&media.join("Artist").join("Album").join("a.mp3"))
        );
        assert_eq!(
            resolver.resolve(rock.id, "b.flac"),
            s(&tmp.0.join("Collection/Rock/b.flac"))
        );
        assert_eq!(resolver.resolve(OTHER_SOURCE_ID, "/x/c.wav"), "/x/c.wav");

        // And back, with `/` separators whatever the platform.
        let file = media.join("Artist").join("a.mp3");
        assert_eq!(
            resolver.relative_path(tracks, &file).unwrap(),
            "Artist/a.mp3"
        );
        assert_eq!(
            resolver.relative_path(OTHER_SOURCE_ID, &file).unwrap(),
            s(&file)
        );
        assert!(resolver.relative_path(rock.id, &file).is_err());
        assert!(resolver.relative_path(tracks, &media).is_err());

        // `locate` keeps a preferred source that contains the file, else finds one.
        let rock_file = tmp.0.join("Collection/Rock/d.mp3");
        assert_eq!(
            resolver.locate(&rock_file, tracks),
            (rock.id, "d.mp3".to_string())
        );
        assert_eq!(
            resolver.locate(&rock_file, OTHER_SOURCE_ID),
            (rock.id, "d.mp3".to_string())
        );
        let loose = tmp.0.join("Downloads/e.mp3");
        assert_eq!(
            resolver.locate(&loose, rock.id),
            (OTHER_SOURCE_ID, s(&loose))
        );
    }

    #[test]
    fn locate_never_puts_spiral_data_in_a_source() {
        let tmp = TempDir::new("locate-data");
        let (conn, roots) = library(&tmp);
        // A source around the Spiral folder, as a library from before sources
        // inside it existed may have.
        let music = tmp.0.join("Music");
        conn.execute(
            "INSERT INTO sources (name, root_path, created_at) VALUES ('Music', ?1, 'now')",
            params![s(&music)],
        )
        .unwrap();
        let music_id = conn.last_insert_rowid();
        let resolver = SourceRoots::load(&conn).unwrap();
        let pack_sound = roots.library_root.join("Packs/sounds/click.wav");
        assert_eq!(
            resolver.locate(&pack_sound, music_id),
            (OTHER_SOURCE_ID, s(&pack_sound))
        );
        assert_eq!(
            resolver.locate(&music.join("a.mp3"), OTHER_SOURCE_ID),
            (music_id, "a.mp3".to_string())
        );
    }

    #[test]
    fn without_a_spiral_folder_relative_roots_are_unknown_and_paths_stay_absolute() {
        let conn = mem_conn();
        conn.execute(
            "INSERT INTO sources (name, root_path, created_at) VALUES ('Tracks', 'Tracks', 'now')",
            [],
        )
        .unwrap();
        let id = conn.last_insert_rowid();
        let resolver = SourceRoots::load(&conn).unwrap();
        assert_eq!(resolver.root(id), None);
        assert_eq!(
            resolver
                .relative_path(id, Path::new("/music/a.mp3"))
                .unwrap(),
            "/music/a.mp3"
        );
        assert_eq!(resolver.resolve(id, "/music/a.mp3"), "/music/a.mp3");
        assert_eq!(get_source(&conn, id).unwrap().unwrap().root_path, None);
    }

    #[cfg(unix)]
    #[test]
    fn resolver_matches_symlinked_spellings() {
        let tmp = TempDir::new("resolve-link-rel");
        let (conn, roots) = library(&tmp);
        let tracks = create_managed_source(&conn, &roots).unwrap().id;
        let media = tracks_folder(&roots);
        let link = tmp.0.join("TracksLink");
        std::os::unix::fs::symlink(&media, &link).unwrap();
        std::fs::write(media.join("a.mp3"), b"x").unwrap();
        let resolver = SourceRoots::load(&conn).unwrap();
        assert_eq!(
            resolver.relative_path(tracks, &link.join("a.mp3")).unwrap(),
            "a.mp3"
        );
    }

    #[test]
    fn moving_a_source_root_moves_its_tracks() {
        let tmp = TempDir::new("move-root");
        let (conn, roots) = library(&tmp);
        let rock = add(&conn, &roots, &tmp.dir("Old/Rock")).unwrap();
        let id = insert_track(&conn, "Artist/a.mp3", rock.id);
        let new_root = tmp.dir("New/Rock");
        let moved = set_source_root(&conn, &roots, rock.id, &s(&new_root)).unwrap();
        assert_eq!(moved.root_path, Some(s(&new_root)));
        assert_eq!(track_location(&conn, id), (rock.id, "Artist/a.mp3".into()));
        let track = crate::db::get_track_by_id(&conn, id).unwrap().unwrap();
        assert_eq!(track.file_path, s(&new_root.join("Artist").join("a.mp3")));

        assert!(set_source_root(&conn, &roots, OTHER_SOURCE_ID, &s(&new_root)).is_err());
        let artwork = s(&tmp.dir("Music/Spiral Library/Artwork"));
        assert!(set_source_root(&conn, &roots, rock.id, &artwork)
            .unwrap_err()
            .starts_with(SOURCE_SPIRAL_DATA));

        // Into the Spiral folder and out again: stored relative to it there.
        let inside = tmp.dir("Music/Spiral Library/Rock");
        let moved = set_source_root(&conn, &roots, rock.id, &s(&inside)).unwrap();
        assert_eq!(moved.root_path, Some(s(&inside)));
        assert_eq!(
            stored_roots(&conn).unwrap(),
            vec![(rock.id, "Rock".to_string())]
        );
        let track = crate::db::get_track_by_id(&conn, id).unwrap().unwrap();
        assert_eq!(track.file_path, s(&inside.join("Artist").join("a.mp3")));
        set_source_root(&conn, &roots, rock.id, &s(&new_root)).unwrap();
        assert_eq!(stored_roots(&conn).unwrap(), vec![(rock.id, s(&new_root))]);
    }

    #[test]
    fn multiple_separate_sources_can_be_added() {
        let tmp = TempDir::new("multi");
        let (conn, roots) = library(&tmp);
        let a = add(&conn, &roots, &tmp.dir("Collection/Rock")).unwrap();
        let b = add(&conn, &roots, &tmp.dir("Collection/Jazz")).unwrap();
        let c = add(&conn, &roots, &tmp.dir("Music/Other")).unwrap();
        assert_eq!(a.name, "Rock");
        assert!(!a.auto_organize && !a.import_target);
        assert_eq!(a.path_format, None);
        assert_ne!(a.id, b.id);
        assert_ne!(b.id, c.id);
        assert_eq!(list_sources(&conn).unwrap().len(), 4);
    }

    #[test]
    fn source_root_cannot_overlap_another_source_root() {
        let tmp = TempDir::new("overlap");
        let (conn, roots) = library(&tmp);
        add(&conn, &roots, &tmp.dir("Collection/Rock")).unwrap();

        let equal = add(&conn, &roots, &tmp.dir("Collection/Rock"));
        let inside = add(&conn, &roots, &tmp.dir("Collection/Rock/Live"));
        let containing = add(&conn, &roots, &tmp.dir("Collection"));
        for result in [equal, inside, containing] {
            assert!(result.unwrap_err().starts_with(SOURCE_OVERLAP));
        }
        assert_eq!(list_sources(&conn).unwrap().len(), 2);
    }

    #[test]
    fn source_root_cannot_be_the_spiral_folder_or_its_data() {
        let tmp = TempDir::new("library");
        let (conn, roots) = library(&tmp);
        for root in [
            roots.library_root.clone(),
            tmp.dir("Music/Spiral Library/Artwork"),
            tmp.dir("Music/Spiral Library/Artwork/albums"),
            tmp.dir("Music/Spiral Library/Packs"),
            tmp.dir("Music/Spiral Library/Packs/sounds"),
        ] {
            let err = add(&conn, &roots, &root).unwrap_err();
            assert!(
                err.starts_with(SOURCE_SPIRAL_DATA),
                "{}: {err}",
                root.display()
            );
        }
        // The database is a file, never a folder.
        assert!(add(&conn, &roots, &roots.library_root.join("Library.db")).is_err());
        assert_eq!(list_sources(&conn).unwrap().len(), 1);
    }

    #[test]
    fn a_source_may_sit_inside_the_spiral_folder() {
        let tmp = TempDir::new("inside");
        let (conn, roots) = library(&tmp);
        let rips = add(&conn, &roots, &tmp.dir("Music/Spiral Library/Rips/Vinyl")).unwrap();
        let tracks = add(&conn, &roots, &tracks_folder(&roots)).unwrap();
        assert_eq!(tracks.root_path, Some(s(&tracks_folder(&roots))));
        assert_eq!(
            stored_roots(&conn).unwrap(),
            vec![
                (rips.id, "Rips/Vinyl".to_string()),
                (tracks.id, "Tracks".to_string()),
            ]
        );
        // The usual overlap rules apply there too.
        assert!(add(&conn, &roots, &tmp.dir("Music/Spiral Library/Rips"))
            .unwrap_err()
            .starts_with(SOURCE_OVERLAP));
        assert!(add(&conn, &roots, &tmp.dir("Music"))
            .unwrap_err()
            .starts_with(SOURCE_OVERLAP));
    }

    #[test]
    fn source_root_may_contain_the_spiral_folder() {
        let tmp = TempDir::new("around");
        let (conn, roots) = library(&tmp);
        let music = add(&conn, &roots, &tmp.dir("Music")).unwrap();
        assert_eq!(music.name, "Music");
        // The usual overlap rules still apply around it.
        assert!(add(&conn, &roots, &tmp.dir("Music/SomeArtist")).is_err());
        assert!(add(&conn, &roots, &tmp.0).is_err());
        // `Tracks` would sit inside it, so it can't become a source now.
        assert!(create_managed_source(&conn, &roots)
            .unwrap_err()
            .starts_with(SOURCE_OVERLAP));
        remove_source(&conn, music.id).unwrap();
        add(&conn, &roots, &tmp.0).unwrap();
    }

    #[test]
    fn the_deepest_source_wins_and_spiral_data_is_other() {
        let tmp = TempDir::new("precedence");
        let (conn, roots) = library(&tmp);
        let tracks = create_managed_source(&conn, &roots).unwrap().id;
        // A source around the Spiral folder, from before `Tracks` was an
        // ordinary source; validation refuses it now.
        conn.execute(
            "INSERT INTO sources (name, root_path, created_at) VALUES ('Music', ?1, 'now')",
            params![s(&tmp.dir("Music"))],
        )
        .unwrap();
        let music = conn.last_insert_rowid();
        let resolve = |p: PathBuf| source_for_path(&conn, &roots, &p).unwrap();
        assert_eq!(resolve(tracks_folder(&roots).join("A/a.mp3")), tracks);
        assert_eq!(
            resolve(roots.library_root.join("Packs/sounds/click.wav")),
            OTHER_SOURCE_ID
        );
        assert_eq!(
            resolve(roots.library_root.join("Artwork/a.mp3")),
            OTHER_SOURCE_ID
        );
        assert_eq!(resolve(roots.library_root.join("b.mp3")), music);
        assert_eq!(resolve(tmp.0.join("Music/SomeArtist/c.mp3")), music);
        assert!(is_spiral_data(
            &roots.library_root.join("Library.db"),
            &roots.library_root
        ));
        assert!(is_spiral_data(
            &roots.library_root.join("Artwork/x.jpg"),
            &roots.library_root
        ));
        assert!(!is_spiral_data(&roots.library_root, &roots.library_root));
        assert!(!is_spiral_data(
            &tracks_folder(&roots).join("x.mp3"),
            &roots.library_root
        ));
    }

    #[cfg(unix)]
    #[test]
    fn source_root_overlap_is_checked_through_symlinks() {
        let tmp = TempDir::new("symlink");
        let (conn, roots) = library(&tmp);
        let real = tmp.dir("Collection");
        add(&conn, &roots, &real).unwrap();
        let link = tmp.0.join("Link");
        std::os::unix::fs::symlink(&real, &link).unwrap();
        assert!(add(&conn, &roots, &link).is_err());
        let artwork_link = tmp.0.join("ArtworkLink");
        std::os::unix::fs::symlink(tmp.dir("Music/Spiral Library/Artwork"), &artwork_link).unwrap();
        assert!(add(&conn, &roots, &artwork_link)
            .unwrap_err()
            .starts_with(SOURCE_SPIRAL_DATA));
    }

    #[test]
    fn source_root_must_be_an_existing_absolute_folder() {
        let tmp = TempDir::new("invalid");
        let (conn, roots) = library(&tmp);
        assert!(add(&conn, &roots, Path::new("relative/folder")).is_err());
        assert!(add(&conn, &roots, &tmp.0.join("missing"))
            .unwrap_err()
            .starts_with(SOURCE_NOT_FOLDER));
    }

    #[test]
    fn source_for_path_prefers_the_deepest_source_then_other() {
        let tmp = TempDir::new("resolve");
        let (conn, roots) = library(&tmp);
        let rock = add(&conn, &roots, &tmp.dir("Collection/Rock")).unwrap();
        // Nested roots are refused by validation; insert one directly to check
        // that the deepest root wins regardless.
        let live = tmp.dir("Collection/Rock/Live");
        conn.execute(
            "INSERT INTO sources (root_path, name, created_at) VALUES (?1, 'Live', 'now')",
            params![s(&live)],
        )
        .unwrap();
        let live_id = conn.last_insert_rowid();

        let tracks = create_managed_source(&conn, &roots).unwrap().id;

        let resolve = |p: PathBuf| source_for_path(&conn, &roots, &p).unwrap();
        assert_eq!(resolve(tmp.0.join("Collection/Rock/a.mp3")), rock.id);
        assert_eq!(resolve(live.join("b.mp3")), live_id);
        assert_eq!(resolve(tracks_folder(&roots).join("A/B/c.mp3")), tracks);
        assert_eq!(resolve(roots.library_root.join("d.mp3")), OTHER_SOURCE_ID);
        assert_eq!(
            resolve(tmp.0.join("Collection/RockAndRoll/e.mp3")),
            OTHER_SOURCE_ID
        );
        assert_eq!(resolve(tmp.0.join("Downloads/f.mp3")), OTHER_SOURCE_ID);
    }

    #[test]
    fn assign_other_tracks_backfills_sources() {
        let tmp = TempDir::new("backfill");
        let (conn, roots) = library(&tmp);
        let tracks = create_managed_source(&conn, &roots).unwrap().id;
        let in_tracks = tracks_folder(&roots).join("A/a.mp3");
        let default_track = insert_track(&conn, &s(&in_tracks), OTHER_SOURCE_ID);
        let elsewhere_file = tmp.0.join("Downloads/b.mp3");
        let elsewhere = insert_track(&conn, &s(&elsewhere_file), OTHER_SOURCE_ID);
        let source_file = tmp.dir("Collection").join("Sub").join("c.mp3");
        let in_source = insert_track(&conn, &s(&source_file), OTHER_SOURCE_ID);

        assert_eq!(assign_other_tracks(&conn, &roots).unwrap(), 1);
        assert_eq!(
            track_location(&conn, default_track),
            (tracks, "A/a.mp3".into())
        );
        assert_eq!(
            track_location(&conn, elsewhere),
            (OTHER_SOURCE_ID, s(&elsewhere_file))
        );
        assert_eq!(track_location(&conn, in_source).0, OTHER_SOURCE_ID);

        // Adding a source claims Other's tracks inside it.
        let collection = add(&conn, &roots, &tmp.0.join("Collection")).unwrap();
        assert_eq!(
            track_location(&conn, in_source),
            (collection.id, "Sub/c.mp3".into())
        );
        assert_eq!(assign_other_tracks(&conn, &roots).unwrap(), 0);
    }

    #[test]
    fn removing_a_source_removes_its_tracks_only() {
        let tmp = TempDir::new("remove");
        let (conn, roots) = library(&tmp);
        let tracks = create_managed_source(&conn, &roots).unwrap();
        let rock = add(&conn, &roots, &tmp.dir("Rock")).unwrap();
        let jazz = add(&conn, &roots, &tmp.dir("Jazz")).unwrap();
        let rock_track = insert_track(&conn, "a.mp3", rock.id);
        let jazz_track = insert_track(&conn, "b.mp3", jazz.id);
        let tracks_track = insert_track(&conn, "c.mp3", tracks.id);
        let other_track = insert_track(&conn, "/x/d.mp3", OTHER_SOURCE_ID);
        let remaining = || -> Vec<i64> {
            conn.prepare("SELECT id FROM tracks ORDER BY id")
                .unwrap()
                .query_map([], |r| r.get(0))
                .unwrap()
                .collect::<Result<_, _>>()
                .unwrap()
        };

        assert_eq!(remove_source(&conn, rock.id).unwrap(), 1);
        assert_eq!(get_source(&conn, rock.id).unwrap(), None);
        assert_eq!(remaining(), vec![jazz_track, tracks_track, other_track]);
        assert!(!remaining().contains(&rock_track));
        assert!(tmp.0.join("Rock").is_dir());

        // `Tracks` is an ordinary source: it goes, its files stay.
        std::fs::write(tracks_folder(&roots).join("c.mp3"), b"x").unwrap();
        assert_eq!(remove_source(&conn, tracks.id).unwrap(), 1);
        assert_eq!(remaining(), vec![jazz_track, other_track]);
        assert!(tracks_folder(&roots).join("c.mp3").is_file());
        assert_eq!(managed_source_id(&conn, &roots).unwrap(), None);

        assert!(remove_source(&conn, OTHER_SOURCE_ID).is_err());
        assert!(remove_source(&conn, 999).is_err());

        // Down to no sources at all.
        remove_source(&conn, jazz.id).unwrap();
        let left = list_sources(&conn).unwrap();
        assert_eq!(
            left.iter().map(|s| s.id).collect::<Vec<_>>(),
            vec![OTHER_SOURCE_ID]
        );
        assert_eq!(remaining(), vec![other_track]);
    }

    #[test]
    fn organize_settings_give_the_effective_format_or_none() {
        let tmp = TempDir::new("organize-settings");
        let (conn, roots) = library(&tmp);
        let rock = add(&conn, &roots, &tmp.dir("Rock")).unwrap();
        let tracks = create_managed_source(&conn, &roots).unwrap().id;
        let built_in = crate::library_organize::DEFAULT_ORGANIZE_PATH_FORMAT;

        // `Tracks` starts organized with Spiral's built-in format.
        assert_eq!(
            organize_settings(&conn, tracks).unwrap(),
            Some(built_in.to_string())
        );
        assert_eq!(organize_settings(&conn, rock.id).unwrap(), None);
        assert_eq!(organize_settings(&conn, OTHER_SOURCE_ID).unwrap(), None);
        assert_eq!(organize_settings(&conn, 999).unwrap(), None);

        set_source_organize(&conn, rock.id, true).unwrap();
        assert_eq!(
            organize_settings(&conn, rock.id).unwrap(),
            Some(built_in.to_string())
        );
        set_source_path_format(&conn, rock.id, Some("{title}.{ext}".into())).unwrap();
        assert_eq!(
            organize_settings(&conn, rock.id).unwrap(),
            Some("{title}.{ext}".to_string())
        );
        set_source_organize(&conn, tracks, false).unwrap();
        assert_eq!(organize_settings(&conn, tracks).unwrap(), None);
    }

    #[test]
    fn write_targets_follow_the_source_and_send_other_to_the_import_source() {
        let tmp = TempDir::new("write-target");
        let (conn, roots) = library(&tmp);
        let built_in = crate::library_organize::DEFAULT_ORGANIZE_PATH_FORMAT;
        let rock = add(&conn, &roots, &tmp.dir("Rock")).unwrap();

        // No import target yet: Other's files have nowhere to go.
        assert!(write_target(&conn, OTHER_SOURCE_ID)
            .unwrap_err()
            .starts_with(NO_SOURCE));

        let tracks = create_managed_source(&conn, &roots).unwrap().id;
        let to_tracks = WriteTarget {
            source_id: tracks,
            root: tracks_folder(&roots),
            path_format: Some(built_in.into()),
        };
        assert_eq!(write_target(&conn, tracks).unwrap(), to_tracks);
        assert_eq!(write_target(&conn, OTHER_SOURCE_ID).unwrap(), to_tracks);

        set_import_source(&conn, rock.id).unwrap();
        let to_rock = WriteTarget {
            source_id: rock.id,
            root: tmp.0.join("Rock"),
            path_format: None,
        };
        assert_eq!(write_target(&conn, rock.id).unwrap(), to_rock);
        assert_eq!(write_target(&conn, OTHER_SOURCE_ID).unwrap(), to_rock);

        // An unplugged folder is never written to (or created).
        std::fs::remove_dir(tmp.0.join("Rock")).unwrap();
        assert!(write_target(&conn, rock.id)
            .unwrap_err()
            .starts_with(SOURCE_UNAVAILABLE));
        assert!(!tmp.0.join("Rock").exists());
        assert!(!import_target(&conn).unwrap().copy_available);
    }

    #[test]
    fn walks_skip_spiral_data_and_nested_sources() {
        let tmp = TempDir::new("walk-skip");
        let library = roots(&tmp);
        let music = tmp.0.join("Music");
        let tracks = tracks_folder(&library);
        let in_tracks = tracks.join("A/a.mp3");
        let in_packs = library.library_root.join("Packs/x.wav");
        let in_artwork = library.library_root.join("Artwork/x.jpg");
        let loose = library.library_root.join("Loose/a.mp3");

        // Without `Tracks` as a source, a source around the Spiral folder
        // skips only its data.
        let mut lr = library.clone();
        lr.source_roots = vec![music.clone()];
        assert!(!is_outside_source_walk(&in_tracks, &music, &lr));
        assert!(!is_outside_source_walk(&loose, &music, &lr));
        assert!(is_outside_source_walk(&in_packs, &music, &lr));
        assert!(is_outside_source_walk(&in_artwork, &music, &lr));
        assert!(is_outside_source_walk(
            &library.library_root.join("Library.db"),
            &music,
            &lr
        ));

        // With `Tracks` as a source too, it skips that as well, and `Tracks`
        // walks its own folder.
        lr.source_roots.push(tracks.clone());
        assert!(is_outside_source_walk(&in_tracks, &music, &lr));
        assert!(!is_outside_source_walk(&loose, &music, &lr));
        assert!(!is_outside_source_walk(&music.join("a.mp3"), &music, &lr));
        assert!(!is_outside_source_walk(&in_tracks, &tracks, &lr));
        assert!(!is_outside_source_walk(&tracks, &tracks, &lr));
    }

    #[test]
    fn organize_and_path_format_are_per_source_except_other() {
        let tmp = TempDir::new("organize");
        let (conn, roots) = library(&tmp);
        let rock = add(&conn, &roots, &tmp.dir("Rock")).unwrap();
        assert!(
            set_source_organize(&conn, rock.id, true)
                .unwrap()
                .auto_organize
        );
        let tracks = create_managed_source(&conn, &roots).unwrap().id;
        assert!(
            !set_source_organize(&conn, tracks, false)
                .unwrap()
                .auto_organize
        );
        assert!(set_source_organize(&conn, OTHER_SOURCE_ID, true).is_err());
        assert!(set_source_organize(&conn, 999, true).is_err());

        let format = "{artist}/{title}".to_string();
        assert_eq!(
            set_source_path_format(&conn, rock.id, Some(format.clone()))
                .unwrap()
                .path_format,
            Some(format)
        );
        // Blank inherits the global format again.
        assert_eq!(
            set_source_path_format(&conn, rock.id, Some("  ".into()))
                .unwrap()
                .path_format,
            None
        );
        assert!(set_source_path_format(&conn, OTHER_SOURCE_ID, Some("x".into())).is_err());
    }

    #[test]
    fn removing_the_import_target_moves_it_to_the_next_reachable_source_or_none() {
        let tmp = TempDir::new("import");
        let (conn, roots) = library(&tmp);
        let tracks = create_managed_source(&conn, &roots).unwrap().id;
        let unplugged = add(&conn, &roots, &tmp.dir("Unplugged")).unwrap();
        let rock = add(&conn, &roots, &tmp.dir("Rock")).unwrap();
        let jazz = add(&conn, &roots, &tmp.dir("Jazz")).unwrap();
        std::fs::remove_dir(tmp.0.join("Unplugged")).unwrap();
        assert_eq!(import_source_id(&conn).unwrap(), Some(tracks));

        assert!(set_import_source(&conn, jazz.id).unwrap().import_target);
        assert_eq!(import_source_id(&conn).unwrap(), Some(jazz.id));
        assert!(!get_source(&conn, tracks).unwrap().unwrap().import_target);
        assert!(set_import_source(&conn, OTHER_SOURCE_ID).is_err());
        assert!(set_import_source(&conn, 999).is_err());
        assert_eq!(import_source_id(&conn).unwrap(), Some(jazz.id));

        // To the lowest id with a reachable folder: `Tracks`.
        remove_source(&conn, jazz.id).unwrap();
        assert_eq!(import_source_id(&conn).unwrap(), Some(tracks));
        // Then past the unplugged one to Rock.
        remove_source(&conn, tracks).unwrap();
        assert_eq!(import_source_id(&conn).unwrap(), Some(rock.id));
        let target = import_target(&conn).unwrap();
        assert_eq!(target.source.map(|s| s.id), Some(rock.id));
        assert!(target.copy_available);
        // Only an unreachable source is left: none.
        remove_source(&conn, rock.id).unwrap();
        assert_eq!(import_source_id(&conn).unwrap(), None);
        assert!(
            !get_source(&conn, unplugged.id)
                .unwrap()
                .unwrap()
                .import_target
        );
    }

    #[test]
    fn creating_the_managed_source_is_idempotent() {
        let tmp = TempDir::new("managed");
        let (conn, roots) = library(&tmp);
        let media = tracks_folder(&roots);
        std::fs::remove_dir(&media).unwrap();

        let tracks = create_managed_source(&conn, &roots).unwrap();
        assert!(media.is_dir());
        assert_eq!(tracks.name, "Tracks");
        assert_eq!(tracks.root_path, Some(s(&media)));
        assert!(tracks.auto_organize && tracks.import_target);
        assert_eq!(
            stored_roots(&conn).unwrap(),
            vec![(tracks.id, "Tracks".to_string())]
        );
        assert_eq!(managed_source_id(&conn, &roots).unwrap(), Some(tracks.id));

        // Again: the same source, settings untouched.
        set_source_organize(&conn, tracks.id, false).unwrap();
        let again = create_managed_source(&conn, &roots).unwrap();
        assert_eq!(again.id, tracks.id);
        assert!(!again.auto_organize);
        assert_eq!(list_sources(&conn).unwrap().len(), 2);

        // Removed and created again, it doesn't take over another import target.
        remove_source(&conn, tracks.id).unwrap();
        let rock = add(&conn, &roots, &tmp.dir("Rock")).unwrap();
        set_import_source(&conn, rock.id).unwrap();
        let recreated = create_managed_source(&conn, &roots).unwrap();
        assert_ne!(recreated.id, tracks.id);
        assert!(recreated.auto_organize && !recreated.import_target);
        assert_eq!(import_source_id(&conn).unwrap(), Some(rock.id));
    }
}
