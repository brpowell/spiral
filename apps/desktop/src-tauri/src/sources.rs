//! Library sources: the folders tracks live in.
//!
//! Every track belongs to a source, and stores its path relative to that
//! source's root, so moving a folder (or the whole Spiral folder) is a single
//! root update. Sources are uniform folders of tracks, each with its own
//! `auto_organize` flag and optional `path_format` (NULL inherits the global
//! format). Two rows are built in, with fixed ids, and the schema keeps both:
//! - the default source ([`DEFAULT_SOURCE_ID`]) is the Spiral folder's
//!   `Tracks` folder. Its root is not stored; it follows the Spiral folder
//!   (where the database lives), so moving that folder never touches this
//!   table. It starts as the import target and organized.
//! - Other ([`OTHER_SOURCE_ID`]) has no root. It holds loose files referenced
//!   one at a time, by absolute path, and is never organized.
//!
//! The Spiral folder itself (database, artwork, packs) is not a source, and no
//! user source may sit inside it. A user source may contain it; walks skip it.

use crate::path_scope::path_forms;
use crate::settings::{self, LibrarySettingsResponse};
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

pub const DEFAULT_SOURCE_ID: i64 = 1;
pub const OTHER_SOURCE_ID: i64 = 2;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub id: i64,
    pub name: String,
    /// The folder the source's files live in. For the default source this is
    /// resolved from the Spiral folder. `None` for Other, and for the default
    /// source when the Spiral folder isn't known (in-memory test databases).
    pub root_path: Option<String>,
    pub auto_organize: bool,
    /// Path format for organizing this source; `None` inherits the global one.
    pub path_format: Option<String>,
    /// New imports are copied into this source.
    pub import_target: bool,
    pub created_at: String,
}

impl Source {
    /// The default source or Other, which can't be removed or moved.
    pub fn is_builtin(&self) -> bool {
        is_builtin(self.id)
    }
}

pub fn is_builtin(source_id: i64) -> bool {
    source_id == DEFAULT_SOURCE_ID || source_id == OTHER_SOURCE_ID
}

/// The library folders sources are resolved against.
#[derive(Debug, Clone)]
pub struct LibraryRoots {
    /// The Spiral folder: database, artwork and packs.
    pub library_root: PathBuf,
    /// The default source's root, `Tracks` in the Spiral folder.
    pub media_folder: PathBuf,
}

impl LibraryRoots {
    pub fn for_library_root(library_root: &Path) -> Self {
        Self {
            library_root: library_root.to_path_buf(),
            media_folder: settings::media_folder_for_root(library_root),
        }
    }

    pub fn from_settings(library: &LibrarySettingsResponse) -> Self {
        Self {
            library_root: PathBuf::from(&library.library_root),
            media_folder: PathBuf::from(&library.media_folder),
        }
    }
}

/// Record which Spiral folder this connection's database belongs to, so the
/// default source's root can be resolved without asking settings. Kept in a
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

/// Turns tracks' stored `(source_id, rel_path)` into absolute paths and back.
/// Every read of a track's file path goes through [`SourceRoots::resolve`].
/// Load it once per query or batch; it holds a copy of the roots.
#[derive(Debug, Clone, Default)]
pub struct SourceRoots {
    roots: HashMap<i64, PathBuf>,
}

impl SourceRoots {
    pub fn load(conn: &Connection) -> Result<Self, rusqlite::Error> {
        let mut roots = HashMap::new();
        if let Some(folder) = spiral_folder(conn)? {
            roots.insert(DEFAULT_SOURCE_ID, settings::media_folder_for_root(&folder));
        }
        let mut stmt =
            conn.prepare("SELECT id, root_path FROM sources WHERE root_path IS NOT NULL")?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                PathBuf::from(row.get::<_, String>(1)?),
            ))
        })?;
        for row in rows {
            let (id, root) = row?;
            roots.insert(id, root);
        }
        Ok(Self { roots })
    }

    /// The source's root folder. `None` for Other, and for the default source
    /// when the Spiral folder isn't known.
    pub fn root(&self, source_id: i64) -> Option<&Path> {
        self.roots.get(&source_id).map(PathBuf::as_path)
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
    /// relative to the source's root, or absolute for Other (and for the
    /// default source when its root isn't known). Fails when the file is not
    /// inside the source's root.
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
    /// it, else in Other by absolute path.
    pub fn locate(&self, path: &Path, preferred: i64) -> (i64, String) {
        if let Ok(rel) = self.relative_path(preferred, path) {
            if preferred != OTHER_SOURCE_ID || self.deepest(path).is_none() {
                return (preferred, rel);
            }
        }
        self.deepest(path)
            .unwrap_or_else(|| (OTHER_SOURCE_ID, path.to_string_lossy().into_owned()))
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
    /// relative to each source root containing it, and absolute (Other, or a
    /// default source with no known root).
    pub fn candidates(&self, path: &Path) -> Vec<(i64, String)> {
        let absolute = path.to_string_lossy().into_owned();
        let mut out: Vec<(i64, String)> = self
            .roots
            .iter()
            .filter_map(|(id, root)| relative_to(path, root).map(|rel| (*id, rel)))
            .collect();
        out.push((OTHER_SOURCE_ID, absolute.clone()));
        if self.root(DEFAULT_SOURCE_ID).is_none() {
            out.push((DEFAULT_SOURCE_ID, absolute));
        }
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

/// Fill in the default source's root, which is not stored.
fn with_resolved_root(mut source: Source, roots: &SourceRoots) -> Source {
    if source.root_path.is_none() {
        source.root_path = roots
            .root(source.id)
            .map(|root| root.to_string_lossy().into_owned());
    }
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

/// Roots of the sources the user added (every source but the two built-ins).
pub fn user_source_roots(conn: &Connection) -> Result<Vec<(i64, PathBuf)>, rusqlite::Error> {
    let mut stmt = conn.prepare("SELECT id, root_path FROM sources WHERE root_path IS NOT NULL")?;
    let roots = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                PathBuf::from(row.get::<_, String>(1)?),
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(roots)
}

/// True when `path` is `root` or inside it, comparing each as given and with
/// symlinks resolved (the same forms `path_scope` checks).
fn is_within(path: &Path, root: &Path) -> bool {
    let roots = path_forms(root);
    path_forms(path)
        .iter()
        .any(|p| roots.iter().any(|r| p.starts_with(r)))
}

fn overlaps(a: &Path, b: &Path) -> bool {
    is_within(a, b) || is_within(b, a)
}

/// Resolves paths to sources without re-reading the user roots each time.
struct Resolver<'a> {
    roots: &'a LibraryRoots,
    user: Vec<(i64, PathBuf)>,
}

impl<'a> Resolver<'a> {
    fn new(conn: &Connection, roots: &'a LibraryRoots) -> Result<Self, rusqlite::Error> {
        Ok(Self {
            roots,
            user: user_source_roots(conn)?,
        })
    }

    fn source_for(&self, path: &Path) -> i64 {
        // The Spiral folder is decided first: a user source may contain it,
        // but never claims what is inside it.
        if is_within(path, &self.roots.media_folder) {
            return DEFAULT_SOURCE_ID;
        }
        if is_within(path, &self.roots.library_root) {
            return OTHER_SOURCE_ID;
        }
        self.user
            .iter()
            .filter(|(_, root)| is_within(path, root))
            .max_by_key(|(_, root)| root.components().count())
            .map_or(OTHER_SOURCE_ID, |(id, _)| *id)
    }
}

/// The source a file at `path` belongs to. Inside the Spiral folder: the
/// default source in its tracks folder, Other elsewhere (artwork, packs).
/// Outside it: the deepest user source containing it, else Other.
pub fn source_for_path(
    conn: &Connection,
    roots: &LibraryRoots,
    path: &Path,
) -> Result<i64, rusqlite::Error> {
    Ok(Resolver::new(conn, roots)?.source_for(path))
}

/// True when user sources must not look at `path`: it is the Spiral folder or
/// inside it (which covers the default source's folder). User sources may
/// contain the Spiral folder, so scans and file watchers skip it with this.
pub fn is_inside_spiral_folder(path: &Path, roots: &LibraryRoots) -> bool {
    is_within(path, &roots.library_root) || is_within(path, &roots.media_folder)
}

/// Move Other's tracks whose files fall under the default source or a user
/// source into it, storing their paths relative to its root. Run when the
/// database opens and when a source is added; a no-op once they are assigned.
/// Returns how many moved.
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

/// Error prefixes from [`validate_source_root`], so the UI can explain them.
pub const SOURCE_NOT_FOLDER: &str = "source_not_folder";
pub const SOURCE_INSIDE_LIBRARY: &str = "source_inside_library";
pub const SOURCE_OVERLAP: &str = "source_overlap";

/// Check a folder can become a source: an absolute, existing folder that
/// neither equals, contains nor sits inside another source's root, and is
/// not the Spiral folder or inside it. It may contain the Spiral folder (e.g.
/// `~/Music` around `~/Music/Spiral Library`); scans skip it. `exclude` skips
/// one source's own root, for moving that source.
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
    if is_inside_spiral_folder(root, roots) {
        return Err(format!(
            "{SOURCE_INSIDE_LIBRARY}: {} is inside the Spiral folder",
            root.display()
        ));
    }
    let user = user_source_roots(conn).map_err(|e| e.to_string())?;
    if let Some((_, other)) = user
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

    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO sources (name, root_path, created_at) VALUES (?1, ?2, ?3)",
        params![name, root.to_string_lossy(), Utc::now().to_rfc3339()],
    )
    .map_err(|e| e.to_string())?;
    let id = tx.last_insert_rowid();
    assign_other_tracks(&tx, roots).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    get_source_or_err(conn, id)
}

/// Remove a user source and its tracks' rows (with their play history,
/// playlist entries and lyrics). The files stay where they are. If it was
/// the import target, imports go to the default source again. Returns how
/// many track rows were removed.
pub fn remove_source(conn: &Connection, id: i64) -> Result<usize, String> {
    if is_builtin(id) {
        return Err("The default and Other sources cannot be removed".to_string());
    }
    let source = get_source_or_err(conn, id)?;
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let removed = tx
        .execute("DELETE FROM tracks WHERE source_id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM sources WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    if source.import_target {
        tx.execute(
            "UPDATE sources SET import_target = 1 WHERE id = ?1",
            params![DEFAULT_SOURCE_ID],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(removed)
}

/// Point a user source at the folder its files moved to. Tracks store paths
/// relative to the root, so only the source row changes; rescan afterwards to
/// pick up what differs.
pub fn set_source_root(
    conn: &Connection,
    roots: &LibraryRoots,
    id: i64,
    new_root: &str,
) -> Result<Source, String> {
    if is_builtin(id) {
        return Err(
            "The default source follows the Spiral folder, and Other has no folder".to_string(),
        );
    }
    get_source_or_err(conn, id)?;
    let new_root = PathBuf::from(new_root.trim());
    validate_source_root(conn, roots, &new_root, Some(id))?;
    conn.execute(
        "UPDATE sources SET root_path = ?1 WHERE id = ?2",
        params![new_root.to_string_lossy(), id],
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

/// The source new imports are copied into: the one marked, else the default.
#[cfg_attr(not(test), allow(dead_code))] // Imports start using it with per-source behavior.
pub fn import_source_id(conn: &Connection) -> Result<i64, rusqlite::Error> {
    Ok(conn
        .query_row(
            "SELECT id FROM sources WHERE import_target = 1",
            [],
            |row| row.get(0),
        )
        .optional()?
        .unwrap_or(DEFAULT_SOURCE_ID))
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

    fn add(conn: &Connection, roots: &LibraryRoots, root: &Path) -> Result<Source, String> {
        add_source(conn, roots, &root.to_string_lossy(), None)
    }

    fn s(path: &Path) -> String {
        path.to_string_lossy().into_owned()
    }

    #[test]
    fn migration_seeds_default_and_other() {
        let tmp = TempDir::new("seed");
        let (conn, roots) = library(&tmp);
        let sources = list_sources(&conn).unwrap();
        assert_eq!(sources.len(), 2);
        let default = &sources[0];
        assert_eq!(default.id, DEFAULT_SOURCE_ID);
        assert!(default.auto_organize && default.import_target);
        assert_eq!(default.path_format, None);
        // Not stored, but resolved from the Spiral folder.
        assert_eq!(default.root_path, Some(s(&roots.media_folder)));
        let stored: Option<String> = conn
            .query_row("SELECT root_path FROM sources WHERE id = 1", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(stored, None);
        let other = &sources[1];
        assert_eq!(other.id, OTHER_SOURCE_ID);
        assert!(!other.auto_organize && !other.import_target);
        assert_eq!(other.root_path, None);
        assert_eq!(import_source_id(&conn).unwrap(), DEFAULT_SOURCE_ID);
    }

    #[test]
    fn schema_protects_the_builtin_sources() {
        let conn = mem_conn();
        for id in [DEFAULT_SOURCE_ID, OTHER_SOURCE_ID] {
            assert!(conn
                .execute("DELETE FROM sources WHERE id = ?1", params![id])
                .is_err());
            assert!(conn
                .execute(
                    "UPDATE sources SET root_path = '/x' WHERE id = ?1",
                    params![id]
                )
                .is_err());
        }
        // Only the built-ins go without a root.
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
        assert!(conn
            .execute(
                "UPDATE sources SET import_target = 1 WHERE id = ?1",
                params![id]
            )
            .is_err());
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
        insert_track(&conn, "a.mp3", DEFAULT_SOURCE_ID);
        insert_track(&conn, "/x/a.mp3", OTHER_SOURCE_ID);
        let duplicate = conn.execute(
            "INSERT INTO tracks (title, rel_path, date_added, source_id) VALUES ('S', 'a.mp3', 'now', 1)",
            [],
        );
        assert!(duplicate.is_err());
    }

    #[test]
    fn resolver_joins_roots_and_relative_paths() {
        let tmp = TempDir::new("resolve-paths");
        let (conn, roots) = library(&tmp);
        let rock = add(&conn, &roots, &tmp.dir("Collection/Rock")).unwrap();
        let resolver = SourceRoots::load(&conn).unwrap();

        assert_eq!(
            resolver.root(DEFAULT_SOURCE_ID),
            Some(roots.media_folder.as_path())
        );
        assert_eq!(resolver.root(OTHER_SOURCE_ID), None);
        assert_eq!(
            resolver.resolve(DEFAULT_SOURCE_ID, "Artist/Album/a.mp3"),
            s(&roots
                .media_folder
                .join("Artist")
                .join("Album")
                .join("a.mp3"))
        );
        assert_eq!(
            resolver.resolve(rock.id, "b.flac"),
            s(&tmp.0.join("Collection/Rock/b.flac"))
        );
        assert_eq!(resolver.resolve(OTHER_SOURCE_ID, "/x/c.wav"), "/x/c.wav");

        // And back, with `/` separators whatever the platform.
        let file = roots.media_folder.join("Artist").join("a.mp3");
        assert_eq!(
            resolver.relative_path(DEFAULT_SOURCE_ID, &file).unwrap(),
            "Artist/a.mp3"
        );
        assert_eq!(
            resolver.relative_path(OTHER_SOURCE_ID, &file).unwrap(),
            s(&file)
        );
        assert!(resolver.relative_path(rock.id, &file).is_err());
        assert!(resolver
            .relative_path(DEFAULT_SOURCE_ID, &roots.media_folder)
            .is_err());

        // `locate` keeps a preferred source that contains the file, else finds one.
        let rock_file = tmp.0.join("Collection/Rock/d.mp3");
        assert_eq!(
            resolver.locate(&rock_file, DEFAULT_SOURCE_ID),
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
    fn resolver_without_a_spiral_folder_keeps_default_paths_absolute() {
        let conn = mem_conn();
        let resolver = SourceRoots::load(&conn).unwrap();
        assert_eq!(resolver.root(DEFAULT_SOURCE_ID), None);
        assert_eq!(
            resolver
                .relative_path(DEFAULT_SOURCE_ID, Path::new("/music/a.mp3"))
                .unwrap(),
            "/music/a.mp3"
        );
        assert_eq!(
            resolver.resolve(DEFAULT_SOURCE_ID, "/music/a.mp3"),
            "/music/a.mp3"
        );
    }

    #[cfg(unix)]
    #[test]
    fn resolver_matches_symlinked_spellings() {
        let tmp = TempDir::new("resolve-link-rel");
        let (conn, roots) = library(&tmp);
        let link = tmp.0.join("TracksLink");
        std::os::unix::fs::symlink(&roots.media_folder, &link).unwrap();
        std::fs::write(roots.media_folder.join("a.mp3"), b"x").unwrap();
        let resolver = SourceRoots::load(&conn).unwrap();
        assert_eq!(
            resolver
                .relative_path(DEFAULT_SOURCE_ID, &link.join("a.mp3"))
                .unwrap(),
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

        assert!(set_source_root(&conn, &roots, DEFAULT_SOURCE_ID, &s(&new_root)).is_err());
        assert!(set_source_root(&conn, &roots, OTHER_SOURCE_ID, &s(&new_root)).is_err());
        let inside_library = s(&roots.media_folder);
        assert!(set_source_root(&conn, &roots, rock.id, &inside_library)
            .unwrap_err()
            .starts_with(SOURCE_INSIDE_LIBRARY));
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
        assert_eq!(list_sources(&conn).unwrap().len(), 5);
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
        assert_eq!(list_sources(&conn).unwrap().len(), 3);
    }

    #[test]
    fn source_root_cannot_be_the_spiral_folder_or_inside_it() {
        let tmp = TempDir::new("library");
        let (conn, roots) = library(&tmp);
        for root in [
            roots.library_root.clone(),
            roots.media_folder.clone(),
            tmp.dir("Music/Spiral Library/Tracks/Artist"),
            tmp.dir("Music/Spiral Library/Artwork"),
            tmp.dir("Music/Spiral Library/Packs"),
        ] {
            let err = add(&conn, &roots, &root).unwrap_err();
            assert!(
                err.starts_with(SOURCE_INSIDE_LIBRARY),
                "{}: {err}",
                root.display()
            );
        }
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
        remove_source(&conn, music.id).unwrap();
        add(&conn, &roots, &tmp.0).unwrap();
    }

    #[test]
    fn the_spiral_folder_wins_over_a_source_around_it() {
        let tmp = TempDir::new("precedence");
        let (conn, roots) = library(&tmp);
        let music = add(&conn, &roots, &tmp.dir("Music")).unwrap();
        let resolve = |p: PathBuf| source_for_path(&conn, &roots, &p).unwrap();
        assert_eq!(
            resolve(roots.media_folder.join("A/a.mp3")),
            DEFAULT_SOURCE_ID
        );
        assert_eq!(
            resolve(roots.library_root.join("Packs/sounds/click.wav")),
            OTHER_SOURCE_ID
        );
        assert_eq!(resolve(roots.library_root.join("b.mp3")), OTHER_SOURCE_ID);
        assert_eq!(resolve(tmp.0.join("Music/SomeArtist/c.mp3")), music.id);
        assert!(is_inside_spiral_folder(&roots.library_root, &roots));
        assert!(is_inside_spiral_folder(
            &roots.media_folder.join("x.mp3"),
            &roots
        ));
        assert!(!is_inside_spiral_folder(
            &tmp.0.join("Music/SomeArtist"),
            &roots
        ));
        assert!(!is_inside_spiral_folder(
            &tmp.0.join("Music/Spiral Library 2"),
            &roots
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
        let library_link = tmp.0.join("LibraryLink");
        std::os::unix::fs::symlink(&roots.media_folder, &library_link).unwrap();
        assert!(add(&conn, &roots, &library_link).is_err());
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

        let resolve = |p: PathBuf| source_for_path(&conn, &roots, &p).unwrap();
        assert_eq!(resolve(tmp.0.join("Collection/Rock/a.mp3")), rock.id);
        assert_eq!(resolve(live.join("b.mp3")), live_id);
        assert_eq!(
            resolve(roots.media_folder.join("A/B/c.mp3")),
            DEFAULT_SOURCE_ID
        );
        assert_eq!(resolve(roots.library_root.join("d.mp3")), OTHER_SOURCE_ID);
        assert_eq!(
            resolve(tmp.0.join("Collection/RockAndRoll/e.mp3")),
            OTHER_SOURCE_ID
        );
        assert_eq!(resolve(tmp.0.join("Downloads/f.mp3")), OTHER_SOURCE_ID);
    }

    #[test]
    fn assign_other_tracks_backfills_default_and_user_sources() {
        let tmp = TempDir::new("backfill");
        let (conn, roots) = library(&tmp);
        let in_tracks = roots.media_folder.join("A/a.mp3");
        let default_track = insert_track(&conn, &s(&in_tracks), OTHER_SOURCE_ID);
        let elsewhere_file = tmp.0.join("Downloads/b.mp3");
        let elsewhere = insert_track(&conn, &s(&elsewhere_file), OTHER_SOURCE_ID);
        let source_file = tmp.dir("Collection").join("Sub").join("c.mp3");
        let in_source = insert_track(&conn, &s(&source_file), OTHER_SOURCE_ID);

        assert_eq!(assign_other_tracks(&conn, &roots).unwrap(), 1);
        assert_eq!(
            track_location(&conn, default_track),
            (DEFAULT_SOURCE_ID, "A/a.mp3".into())
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
        let rock = add(&conn, &roots, &tmp.dir("Rock")).unwrap();
        let jazz = add(&conn, &roots, &tmp.dir("Jazz")).unwrap();
        let rock_track = insert_track(&conn, "a.mp3", rock.id);
        let jazz_track = insert_track(&conn, "b.mp3", jazz.id);
        let default_track = insert_track(&conn, "c.mp3", DEFAULT_SOURCE_ID);

        assert_eq!(remove_source(&conn, rock.id).unwrap(), 1);
        assert_eq!(get_source(&conn, rock.id).unwrap(), None);
        let remaining: Vec<i64> = conn
            .prepare("SELECT id FROM tracks ORDER BY id")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(remaining, vec![jazz_track, default_track]);
        assert!(!remaining.contains(&rock_track));
        assert!(tmp.0.join("Rock").is_dir());

        assert!(remove_source(&conn, DEFAULT_SOURCE_ID).is_err());
        assert!(remove_source(&conn, OTHER_SOURCE_ID).is_err());
        assert!(remove_source(&conn, 999).is_err());
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
        assert!(
            !set_source_organize(&conn, DEFAULT_SOURCE_ID, false)
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
    fn import_target_moves_and_falls_back_to_default() {
        let tmp = TempDir::new("import");
        let (conn, roots) = library(&tmp);
        let rock = add(&conn, &roots, &tmp.dir("Rock")).unwrap();
        assert!(set_import_source(&conn, rock.id).unwrap().import_target);
        assert_eq!(import_source_id(&conn).unwrap(), rock.id);
        assert!(
            !get_source(&conn, DEFAULT_SOURCE_ID)
                .unwrap()
                .unwrap()
                .import_target
        );
        assert!(set_import_source(&conn, OTHER_SOURCE_ID).is_err());
        assert!(set_import_source(&conn, 999).is_err());
        assert_eq!(import_source_id(&conn).unwrap(), rock.id);

        remove_source(&conn, rock.id).unwrap();
        assert_eq!(import_source_id(&conn).unwrap(), DEFAULT_SOURCE_ID);
        assert!(
            get_source(&conn, DEFAULT_SOURCE_ID)
                .unwrap()
                .unwrap()
                .import_target
        );
    }
}
