//! Versioned schema migrations for the library database.
//!
//! The schema version lives in SQLite's `PRAGMA user_version`. Migrations are
//! an append-only, ordered list: a fresh database runs all of them from empty,
//! and an existing database runs only the ones newer than its stored version.
//! That keeps a single source of truth for the schema and guarantees a
//! brand-new install and a long-lived library end up with the same shape.
//!
//! Rules for adding a migration:
//! - Append to [`MIGRATIONS`] with the next version number; never edit or
//!   reorder an existing entry (it has already run on users' databases).
//! - Do not reference the current schema from an old migration. Spell out the
//!   SQL it needs, so later changes can't alter what it does.
//! - Changing a primary key, unique constraint or column type requires
//!   rebuilding the table (create new, copy, drop, rename). `CREATE TABLE IF
//!   NOT EXISTS` never updates a table that already exists.
//! - Each migration runs in its own transaction together with its version
//!   bump, so a failure leaves the database at the previous version.
//! - Add a test below for what the migration does to existing data.
//! - Add a fixture for the version you are migrating *from* (see
//!   `tests/fixtures/db/`); a test fails until you do.
//!
//! Full process: `apps/desktop/docs/contributing/database-migrations.md`.

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use std::path::{Path, PathBuf};

struct Migration {
    version: i64,
    name: &'static str,
    up: fn(&Connection) -> Result<(), rusqlite::Error>,
}

const MIGRATIONS: &[Migration] = &[
    Migration {
        version: 1,
        name: "baseline",
        up: baseline_catch_up,
    },
    Migration {
        version: 2,
        name: "artist_images_single_key",
        up: artist_images_single_key,
    },
    Migration {
        version: 3,
        name: "library_sources",
        up: library_sources,
    },
    Migration {
        version: 4,
        name: "track_file_stat",
        up: track_file_stat,
    },
    Migration {
        version: 5,
        name: "uniform_sources",
        up: uniform_sources,
    },
];

fn latest_version() -> i64 {
    MIGRATIONS.last().map_or(0, |m| m.version)
}

fn other_error(message: String) -> rusqlite::Error {
    rusqlite::Error::ToSqlConversionFailure(message.into())
}

pub(crate) fn schema_version(conn: &Connection) -> Result<i64, rusqlite::Error> {
    conn.query_row("PRAGMA user_version", [], |row| row.get(0))
}

/// Bring `conn` up to the latest schema. `db_path` (when the database is a
/// file) is used to write a pre-migration backup next to it.
pub fn run(conn: &Connection, db_path: Option<&Path>) -> Result<(), rusqlite::Error> {
    let current = schema_version(conn)?;
    let latest = latest_version();
    if current > latest {
        return Err(other_error(format!(
            "library database is schema version {current}, but this version of Spiral only \
             understands up to {latest}; update Spiral to open it"
        )));
    }
    if current == latest {
        return Ok(());
    }

    // Skip the backup for a brand-new (empty) database: nothing to lose.
    if current > 0 || table_exists(conn, "tracks")? {
        if let Some(path) = db_path {
            backup_before_migrating(conn, path, current)?;
        }
    }

    // Table rebuilds need foreign keys off, and the pragma is a no-op inside a
    // transaction, so toggle it around the whole run.
    let foreign_keys: bool = conn.query_row("PRAGMA foreign_keys", [], |row| row.get(0))?;
    conn.execute_batch("PRAGMA foreign_keys = OFF;")?;
    let result = apply_pending(conn, current, latest);
    if foreign_keys {
        conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    }
    result
}

fn apply_pending(conn: &Connection, current: i64, target: i64) -> Result<(), rusqlite::Error> {
    for migration in MIGRATIONS
        .iter()
        .filter(|m| m.version > current && m.version <= target)
    {
        let wrap = |e: rusqlite::Error| {
            other_error(format!(
                "migration {} ({}) failed: {e}",
                migration.version, migration.name
            ))
        };
        conn.execute_batch("BEGIN IMMEDIATE")?;
        let outcome = (migration.up)(conn)
            .and_then(|()| {
                conn.execute_batch(&format!("PRAGMA user_version = {}", migration.version))
            })
            .and_then(|()| check_foreign_keys(conn));
        match outcome {
            Ok(()) => conn.execute_batch("COMMIT")?,
            Err(e) => {
                let _ = conn.execute_batch("ROLLBACK");
                return Err(wrap(e));
            }
        }
    }
    Ok(())
}

fn check_foreign_keys(conn: &Connection) -> Result<(), rusqlite::Error> {
    let violations: i64 =
        conn.query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |row| {
            row.get(0)
        })?;
    if violations > 0 {
        return Err(other_error(format!(
            "{violations} foreign key violation(s) after migration"
        )));
    }
    Ok(())
}

/// Copy the database to `<name>.bak-v<version>` before changing it, so a bad
/// migration is recoverable. Uses `VACUUM INTO`, which yields a consistent
/// copy even with the database open.
fn backup_before_migrating(
    conn: &Connection,
    db_path: &Path,
    version: i64,
) -> Result<(), rusqlite::Error> {
    let Some(file_name) = db_path.file_name().and_then(|n| n.to_str()) else {
        return Ok(());
    };
    let backup = db_path.with_file_name(format!("{file_name}.bak-v{version}"));
    if backup.exists() {
        // Keep the first backup taken from this version; it predates any
        // attempted migration.
        return Ok(());
    }
    conn.execute("VACUUM INTO ?1", [backup.to_string_lossy().as_ref()])?;
    Ok(())
}

pub(crate) fn table_exists(conn: &Connection, table: &str) -> Result<bool, rusqlite::Error> {
    conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
        [table],
        |row| row.get::<_, i64>(0),
    )
    .map(|count| count > 0)
}

pub(crate) fn table_columns(
    conn: &Connection,
    table: &str,
) -> Result<Vec<String>, rusqlite::Error> {
    let sql = format!("PRAGMA table_info({table})");
    let mut stmt = conn.prepare(&sql)?;
    let columns = stmt
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(columns)
}

/// v1: everything that existed before versioning. Creates missing tables and
/// adds any column an older release didn't have, so it is safe on an empty
/// database, a current one, and a legacy one with no recorded version.
const BASELINE_SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS tracks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  artist TEXT,
  album TEXT,
  album_artist TEXT,
  track_number INTEGER,
  total_tracks INTEGER,
  disc_number INTEGER,
  total_discs INTEGER,
  year INTEGER,
  genre TEXT,
  duration_seconds REAL,
  sample_rate INTEGER,
  bitrate INTEGER,
  codec TEXT,
  file_path TEXT NOT NULL UNIQUE,
  art_path TEXT,
  date_added TEXT NOT NULL,
  play_count INTEGER NOT NULL DEFAULT 0,
  last_played_at TEXT,
  rating INTEGER NOT NULL DEFAULT 0,
  recording_mbid TEXT,
  release_mbid TEXT,
  artist_mbids TEXT,
  album_artist_mbids TEXT
);

CREATE TABLE IF NOT EXISTS listen_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  listened_seconds REAL NOT NULL,
  library_listened_seconds REAL NOT NULL DEFAULT 0,
  skin_listened_seconds REAL NOT NULL DEFAULT 0,
  track_duration_seconds REAL,
  completion TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'library',
  ui_mode TEXT NOT NULL DEFAULT 'library',
  theme_id TEXT,
  theme_name TEXT,
  skin_id TEXT,
  skin_name TEXT,
  visualizer_id TEXT,
  visualizer_name TEXT
);

CREATE INDEX IF NOT EXISTS idx_listen_events_ended_at ON listen_events(ended_at);
CREATE INDEX IF NOT EXISTS idx_listen_events_track_id ON listen_events(track_id);

CREATE TABLE IF NOT EXISTS playlists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  date_created TEXT NOT NULL,
  last_used_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS playlist_tracks (
  playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  PRIMARY KEY (playlist_id, track_id)
);

CREATE TABLE IF NOT EXISTS artist_images (
  artist_key TEXT NOT NULL PRIMARY KEY,
  art_path TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS track_lyrics (
  track_id INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
  format TEXT NOT NULL DEFAULT 'plain',
  source TEXT,
  lines_json TEXT NOT NULL,
  plain_text TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS musicbrainz_entities (
  kind TEXT NOT NULL,
  mbid TEXT NOT NULL,
  json TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (kind, mbid)
);
";

fn baseline_catch_up(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(BASELINE_SCHEMA)?;

    let track_columns = table_columns(conn, "tracks")?;

    if !track_columns.iter().any(|c| c == "date_added") {
        conn.execute(
            "ALTER TABLE tracks ADD COLUMN date_added TEXT NOT NULL DEFAULT ''",
            [],
        )?;
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE tracks SET date_added = ?1 WHERE date_added = ''",
            params![now],
        )?;
    }

    if !track_columns.iter().any(|c| c == "play_count") {
        conn.execute(
            "ALTER TABLE tracks ADD COLUMN play_count INTEGER NOT NULL DEFAULT 0",
            [],
        )?;
    }

    if !track_columns.iter().any(|c| c == "last_played_at") {
        conn.execute("ALTER TABLE tracks ADD COLUMN last_played_at TEXT", [])?;
    }

    if !track_columns.iter().any(|c| c == "rating") {
        conn.execute(
            "ALTER TABLE tracks ADD COLUMN rating INTEGER NOT NULL DEFAULT 0",
            [],
        )?;
    }

    if !track_columns.iter().any(|c| c == "sample_rate") {
        conn.execute("ALTER TABLE tracks ADD COLUMN sample_rate INTEGER", [])?;
    }
    if !track_columns.iter().any(|c| c == "bitrate") {
        conn.execute("ALTER TABLE tracks ADD COLUMN bitrate INTEGER", [])?;
    }
    if !track_columns.iter().any(|c| c == "codec") {
        conn.execute("ALTER TABLE tracks ADD COLUMN codec TEXT", [])?;
    }
    if !track_columns.iter().any(|c| c == "total_tracks") {
        conn.execute("ALTER TABLE tracks ADD COLUMN total_tracks INTEGER", [])?;
    }
    if !track_columns.iter().any(|c| c == "total_discs") {
        conn.execute("ALTER TABLE tracks ADD COLUMN total_discs INTEGER", [])?;
    }
    if !track_columns.iter().any(|c| c == "recording_mbid") {
        conn.execute("ALTER TABLE tracks ADD COLUMN recording_mbid TEXT", [])?;
    }
    if !track_columns.iter().any(|c| c == "release_mbid") {
        conn.execute("ALTER TABLE tracks ADD COLUMN release_mbid TEXT", [])?;
    }
    if !track_columns.iter().any(|c| c == "artist_mbids") {
        conn.execute("ALTER TABLE tracks ADD COLUMN artist_mbids TEXT", [])?;
    }
    if !track_columns.iter().any(|c| c == "album_artist_mbids") {
        conn.execute("ALTER TABLE tracks ADD COLUMN album_artist_mbids TEXT", [])?;
    }

    let playlist_columns = table_columns(conn, "playlists")?;
    if !playlist_columns.iter().any(|c| c == "image_mode") {
        conn.execute(
            "ALTER TABLE playlists ADD COLUMN image_mode TEXT NOT NULL DEFAULT 'generated'",
            [],
        )?;
    }
    if !playlist_columns.iter().any(|c| c == "custom_image_path") {
        conn.execute(
            "ALTER TABLE playlists ADD COLUMN custom_image_path TEXT",
            [],
        )?;
    }
    if !playlist_columns.iter().any(|c| c == "cover_background") {
        conn.execute("ALTER TABLE playlists ADD COLUMN cover_background TEXT", [])?;
    }
    if !playlist_columns.iter().any(|c| c == "cover_background_end") {
        conn.execute(
            "ALTER TABLE playlists ADD COLUMN cover_background_end TEXT",
            [],
        )?;
    }
    if !playlist_columns.iter().any(|c| c == "cover_icon") {
        conn.execute("ALTER TABLE playlists ADD COLUMN cover_icon TEXT", [])?;
    }
    if !playlist_columns.iter().any(|c| c == "position") {
        conn.execute(
            "ALTER TABLE playlists ADD COLUMN position INTEGER NOT NULL DEFAULT 0",
            [],
        )?;
        let ids: Vec<i64> = {
            let mut stmt =
                conn.prepare("SELECT id FROM playlists ORDER BY title COLLATE NOCASE, id ASC")?;
            let ids = stmt
                .query_map([], |row| row.get(0))?
                .collect::<Result<Vec<_>, _>>()?;
            ids
        };
        for (position, id) in ids.iter().enumerate() {
            conn.execute(
                "UPDATE playlists SET position = ?1 WHERE id = ?2",
                params![position as i64, id],
            )?;
        }
    }

    if !table_exists(conn, "track_lyrics")? {
        conn.execute_batch(
            "CREATE TABLE track_lyrics (
                track_id INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
                format TEXT NOT NULL DEFAULT 'plain',
                source TEXT,
                lines_json TEXT NOT NULL,
                plain_text TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL
            );",
        )?;
    }

    if !table_exists(conn, "listen_events")? {
        conn.execute_batch(
            "CREATE TABLE listen_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
                started_at TEXT NOT NULL,
                ended_at TEXT NOT NULL,
                listened_seconds REAL NOT NULL,
                library_listened_seconds REAL NOT NULL DEFAULT 0,
                skin_listened_seconds REAL NOT NULL DEFAULT 0,
                track_duration_seconds REAL,
                completion TEXT NOT NULL,
                source TEXT NOT NULL DEFAULT 'library',
                ui_mode TEXT NOT NULL DEFAULT 'library',
                theme_id TEXT,
                theme_name TEXT,
                skin_id TEXT,
                skin_name TEXT,
                visualizer_id TEXT,
                visualizer_name TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_listen_events_ended_at ON listen_events(ended_at);
            CREATE INDEX IF NOT EXISTS idx_listen_events_track_id ON listen_events(track_id);",
        )?;
    } else {
        let listen_columns = table_columns(conn, "listen_events")?;
        if !listen_columns.iter().any(|c| c == "ui_mode") {
            conn.execute(
                "ALTER TABLE listen_events ADD COLUMN ui_mode TEXT NOT NULL DEFAULT 'library'",
                [],
            )?;
        }
        if !listen_columns
            .iter()
            .any(|c| c == "library_listened_seconds")
        {
            conn.execute(
                "ALTER TABLE listen_events ADD COLUMN library_listened_seconds REAL NOT NULL DEFAULT 0",
                [],
            )?;
            // Best-effort backfill: attribute prior totals to the stamped ui_mode.
            conn.execute(
                "UPDATE listen_events SET library_listened_seconds = listened_seconds
                 WHERE ui_mode = 'library' OR ui_mode IS NULL OR ui_mode = ''",
                [],
            )?;
        }
        if !listen_columns.iter().any(|c| c == "skin_listened_seconds") {
            conn.execute(
                "ALTER TABLE listen_events ADD COLUMN skin_listened_seconds REAL NOT NULL DEFAULT 0",
                [],
            )?;
            conn.execute(
                "UPDATE listen_events SET skin_listened_seconds = listened_seconds
                 WHERE ui_mode = 'skin'",
                [],
            )?;
        }
        if !listen_columns.iter().any(|c| c == "theme_name") {
            conn.execute("ALTER TABLE listen_events ADD COLUMN theme_name TEXT", [])?;
        }
        if listen_columns.iter().any(|c| c == "skin_view_id") {
            // Drop unused Phase 1 column (SQLite 3.35+).
            let _ = conn.execute("ALTER TABLE listen_events DROP COLUMN skin_view_id", []);
        }
    }

    if !table_exists(conn, "musicbrainz_entities")? {
        conn.execute_batch(
            "CREATE TABLE musicbrainz_entities (
                kind TEXT NOT NULL,
                mbid TEXT NOT NULL,
                json TEXT NOT NULL,
                fetched_at TEXT NOT NULL,
                PRIMARY KEY (kind, mbid)
            );",
        )?;
    }

    Ok(())
}

/// v2: `artist_images` was keyed by `(artist_key, browse_mode)` in older
/// releases and by `artist_key` alone now. `CREATE TABLE IF NOT EXISTS` left
/// the old key in place, so upserts failed with "ON CONFLICT clause does not
/// match any PRIMARY KEY or UNIQUE constraint". Rebuild with the new key.
fn artist_images_single_key(conn: &Connection) -> Result<(), rusqlite::Error> {
    let single_key = {
        let mut stmt =
            conn.prepare("SELECT name FROM pragma_table_info('artist_images') WHERE pk > 0")?;
        let pk = stmt
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        pk == ["artist_key"]
    };
    if single_key {
        return Ok(());
    }

    conn.execute_batch(
        "CREATE TABLE artist_images_new (
            artist_key TEXT NOT NULL PRIMARY KEY,
            art_path TEXT NOT NULL
        );
        -- Old rows could hold one image per browse mode; keep the newest.
        INSERT INTO artist_images_new (artist_key, art_path)
            SELECT artist_key, art_path FROM artist_images
            WHERE rowid IN (SELECT MAX(rowid) FROM artist_images GROUP BY artist_key);
        DROP TABLE artist_images;
        ALTER TABLE artist_images_new RENAME TO artist_images;",
    )
}

/// v3: every track belongs to a library source. `managed` (id 1) is Spiral's
/// tracks folder, `external` (id 2) holds files referenced one at a time, and
/// `watched` rows are user folders indexed in place. The managed root is not
/// stored: it follows the library location in settings. Existing tracks start
/// as external; `sources::assign_external_tracks` moves the ones under the
/// tracks folder to managed when the database is opened, since that needs the
/// library location. Rebuilds `tracks` to add the `NOT NULL` foreign key.
fn library_sources(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "CREATE TABLE sources (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            kind TEXT NOT NULL CHECK (kind IN ('managed', 'watched', 'external')),
            root_path TEXT,
            name TEXT NOT NULL,
            writable INTEGER NOT NULL DEFAULT 0 CHECK (writable IN (0, 1)),
            created_at TEXT NOT NULL,
            CHECK ((kind = 'watched') = (root_path IS NOT NULL))
        );
        CREATE UNIQUE INDEX idx_sources_single_kind ON sources(kind)
            WHERE kind IN ('managed', 'external');
        CREATE UNIQUE INDEX idx_sources_watched_root ON sources(root_path)
            WHERE kind = 'watched';
        CREATE TRIGGER sources_keep_builtin BEFORE DELETE ON sources
            WHEN old.kind != 'watched'
            BEGIN SELECT RAISE(ABORT, 'the managed and external sources cannot be removed'); END;
        CREATE TRIGGER sources_keep_kind BEFORE UPDATE OF kind ON sources
            WHEN new.kind != old.kind
            BEGIN SELECT RAISE(ABORT, 'a source cannot change kind'); END;",
    )?;
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO sources (id, kind, root_path, name, writable, created_at)
         VALUES (1, 'managed', NULL, 'Spiral Library', 1, ?1),
                (2, 'external', NULL, 'Other Files', 0, ?1)",
        params![now],
    )?;

    conn.execute_batch(
        "CREATE TABLE tracks_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            artist TEXT,
            album TEXT,
            album_artist TEXT,
            track_number INTEGER,
            total_tracks INTEGER,
            disc_number INTEGER,
            total_discs INTEGER,
            year INTEGER,
            genre TEXT,
            duration_seconds REAL,
            sample_rate INTEGER,
            bitrate INTEGER,
            codec TEXT,
            file_path TEXT NOT NULL UNIQUE,
            art_path TEXT,
            date_added TEXT NOT NULL,
            play_count INTEGER NOT NULL DEFAULT 0,
            last_played_at TEXT,
            rating INTEGER NOT NULL DEFAULT 0,
            recording_mbid TEXT,
            release_mbid TEXT,
            artist_mbids TEXT,
            album_artist_mbids TEXT,
            source_id INTEGER NOT NULL REFERENCES sources(id),
            missing_since TEXT
        );",
    )?;

    // Copy the columns this database has; very old libraries never gained some
    // of them, and their new-table defaults stand in.
    const COPIED_COLUMNS: &[&str] = &[
        "id",
        "title",
        "artist",
        "album",
        "album_artist",
        "track_number",
        "total_tracks",
        "disc_number",
        "total_discs",
        "year",
        "genre",
        "duration_seconds",
        "sample_rate",
        "bitrate",
        "codec",
        "file_path",
        "art_path",
        "date_added",
        "play_count",
        "last_played_at",
        "rating",
        "recording_mbid",
        "release_mbid",
        "artist_mbids",
        "album_artist_mbids",
    ];
    let existing = table_columns(conn, "tracks")?;
    let columns = COPIED_COLUMNS
        .iter()
        .filter(|c| existing.iter().any(|e| e == *c))
        .copied()
        .collect::<Vec<_>>()
        .join(", ");
    conn.execute_batch(&format!(
        "INSERT INTO tracks_new ({columns}, source_id) SELECT {columns}, 2 FROM tracks;"
    ))?;

    conn.execute_batch(
        "-- Keep AUTOINCREMENT from reusing ids of tracks deleted before the rebuild.
        UPDATE sqlite_sequence
            SET seq = MAX(seq, COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'tracks'), 0))
            WHERE name = 'tracks_new';
        INSERT INTO sqlite_sequence (name, seq)
            SELECT 'tracks_new', seq FROM sqlite_sequence
            WHERE name = 'tracks'
              AND NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = 'tracks_new');
        DROP TABLE tracks;
        ALTER TABLE tracks_new RENAME TO tracks;
        CREATE INDEX idx_tracks_source_id ON tracks(source_id);",
    )
}

/// v4: remember each track file's size and modification time as last read, so
/// rescanning a watched folder re-reads only files whose size or time changed.
/// NULL until a scan records them.
fn track_file_stat(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "ALTER TABLE tracks ADD COLUMN file_size INTEGER;
        ALTER TABLE tracks ADD COLUMN file_mtime_ms INTEGER;",
    )
}

/// v5: sources become uniform folders of tracks, and tracks store a path
/// relative to their source's root instead of an absolute path.
///
/// - `sources` loses `kind` and `writable` and gains `auto_organize`,
///   `path_format` (NULL inherits the global format) and `import_target`
///   (where new imports are copied; at most one row). Ids 1 and 2 stay as the
///   two built-in rows: 1 is the default source, whose root is not stored but
///   is the Spiral folder's `Tracks` folder, and 2 is Other, loose files with
///   no root. Triggers keep both from being deleted and keep their roots NULL.
///   Managed becomes the default source (organized, import target), each
///   watched folder keeps its row with organize off, and external becomes
///   Other.
/// - `tracks.file_path` becomes `rel_path`, unique per source. Other keeps
///   absolute paths. A path outside its source's root moves to Other. When the
///   Spiral folder isn't known (an in-memory database), default-source paths
///   stay absolute, which still resolves to the same file.
///
/// The Spiral folder comes from the per-connection `temp.spiral_folder` table
/// that `db::open` fills in before migrating.
fn uniform_sources(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "CREATE TABLE sources_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            root_path TEXT,
            auto_organize INTEGER NOT NULL DEFAULT 0 CHECK (auto_organize IN (0, 1)),
            path_format TEXT,
            import_target INTEGER NOT NULL DEFAULT 0 CHECK (import_target IN (0, 1)),
            created_at TEXT NOT NULL,
            CHECK (id IS NOT 2 OR (auto_organize = 0 AND path_format IS NULL AND import_target = 0))
        );
        INSERT INTO sources_new (id, name, root_path, auto_organize, import_target, created_at)
            SELECT id, name,
                   CASE WHEN kind = 'watched' THEN root_path END,
                   kind = 'managed', kind = 'managed', created_at
            FROM sources;
        -- Keep AUTOINCREMENT from reusing ids of removed folders.
        UPDATE sqlite_sequence
            SET seq = MAX(seq, COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'sources'), 0))
            WHERE name = 'sources_new';
        DROP TABLE sources;
        ALTER TABLE sources_new RENAME TO sources;
        CREATE UNIQUE INDEX idx_sources_root ON sources(root_path);
        CREATE UNIQUE INDEX idx_sources_import_target ON sources(import_target)
            WHERE import_target = 1;
        CREATE TRIGGER sources_keep_builtin BEFORE DELETE ON sources
            WHEN old.id IN (1, 2)
            BEGIN SELECT RAISE(ABORT, 'the default and Other sources cannot be removed'); END;
        CREATE TRIGGER sources_root_on_insert BEFORE INSERT ON sources
            WHEN (new.root_path IS NULL) != (new.id IS NOT NULL AND new.id IN (1, 2))
            BEGIN SELECT RAISE(ABORT, 'only the default and Other sources have no root'); END;
        CREATE TRIGGER sources_root_on_update BEFORE UPDATE OF id, root_path ON sources
            WHEN new.id != old.id OR (new.root_path IS NULL) != (old.id IN (1, 2))
            BEGIN SELECT RAISE(ABORT, 'only the default and Other sources have no root'); END;",
    )?;

    conn.execute_batch(
        "CREATE TABLE tracks_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            artist TEXT,
            album TEXT,
            album_artist TEXT,
            track_number INTEGER,
            total_tracks INTEGER,
            disc_number INTEGER,
            total_discs INTEGER,
            year INTEGER,
            genre TEXT,
            duration_seconds REAL,
            sample_rate INTEGER,
            bitrate INTEGER,
            codec TEXT,
            source_id INTEGER NOT NULL REFERENCES sources(id),
            rel_path TEXT NOT NULL,
            art_path TEXT,
            date_added TEXT NOT NULL,
            play_count INTEGER NOT NULL DEFAULT 0,
            last_played_at TEXT,
            rating INTEGER NOT NULL DEFAULT 0,
            recording_mbid TEXT,
            release_mbid TEXT,
            artist_mbids TEXT,
            album_artist_mbids TEXT,
            missing_since TEXT,
            file_size INTEGER,
            file_mtime_ms INTEGER,
            UNIQUE (source_id, rel_path)
        );",
    )?;

    // Work out each track's new (source, rel_path) before copying.
    let tracks_folder = migration_spiral_folder(conn)?.map(|f| f.join("Tracks"));
    let roots: Vec<(i64, Option<PathBuf>)> = conn
        .prepare("SELECT id, root_path FROM sources")?
        .query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, Option<String>>(1)?.map(PathBuf::from),
            ))
        })?
        .collect::<Result<_, _>>()?;
    let rows: Vec<(i64, i64, String)> = conn
        .prepare("SELECT id, source_id, file_path FROM tracks")?
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
        .collect::<Result<_, _>>()?;

    conn.execute_batch(
        "INSERT INTO tracks_new (
            id, title, artist, album, album_artist, track_number, total_tracks, disc_number,
            total_discs, year, genre, duration_seconds, sample_rate, bitrate, codec, source_id,
            rel_path, art_path, date_added, play_count, last_played_at, rating, recording_mbid,
            release_mbid, artist_mbids, album_artist_mbids, missing_since, file_size, file_mtime_ms
        )
        SELECT
            id, title, artist, album, album_artist, track_number, total_tracks, disc_number,
            total_discs, year, genre, duration_seconds, sample_rate, bitrate, codec, source_id,
            file_path, art_path, date_added, play_count, last_played_at, rating, recording_mbid,
            release_mbid, artist_mbids, album_artist_mbids, missing_since, file_size, file_mtime_ms
        FROM tracks;",
    )?;
    {
        let mut update =
            conn.prepare("UPDATE tracks_new SET source_id = ?1, rel_path = ?2 WHERE id = ?3")?;
        for (id, source_id, file_path) in rows {
            let root = match source_id {
                1 => tracks_folder.clone(),
                2 => continue,
                _ => roots
                    .iter()
                    .find(|(sid, _)| *sid == source_id)
                    .and_then(|(_, r)| r.clone()),
            };
            let Some(root) = root else {
                // Default source with no known Spiral folder: keep the
                // absolute path, which resolves to itself.
                continue;
            };
            match migration_relative_path(Path::new(&file_path), &root) {
                Some(rel) => update.execute(params![source_id, rel, id])?,
                None => update.execute(params![2, file_path, id])?,
            };
        }
    }

    conn.execute_batch(
        "UPDATE sqlite_sequence
            SET seq = MAX(seq, COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'tracks'), 0))
            WHERE name = 'tracks_new';
        INSERT INTO sqlite_sequence (name, seq)
            SELECT 'tracks_new', seq FROM sqlite_sequence
            WHERE name = 'tracks'
              AND NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = 'tracks_new');
        DROP TABLE tracks;
        ALTER TABLE tracks_new RENAME TO tracks;",
    )
}

/// The Spiral folder `db::open` recorded for this connection, if any. Spelled
/// out here rather than shared with `sources`, so later changes there can't
/// alter what migration 5 does.
fn migration_spiral_folder(conn: &Connection) -> Result<Option<PathBuf>, rusqlite::Error> {
    let recorded: bool = conn.query_row(
        "SELECT COUNT(*) > 0 FROM sqlite_temp_master WHERE type = 'table' AND name = 'spiral_folder'",
        [],
        |row| row.get(0),
    )?;
    if !recorded {
        return Ok(None);
    }
    conn.query_row("SELECT path FROM temp.spiral_folder", [], |row| {
        row.get::<_, String>(0)
    })
    .optional()
    .map(|path| path.map(PathBuf::from))
}

/// `path` relative to `root` with `/` separators, comparing as given and with
/// symlinks resolved. `None` when `path` is not inside `root`.
fn migration_relative_path(path: &Path, root: &Path) -> Option<String> {
    let rel = path
        .strip_prefix(root)
        .ok()
        .map(Path::to_path_buf)
        .or_else(|| {
            let root = root.canonicalize().ok()?;
            let path = path.canonicalize().ok()?;
            path.strip_prefix(&root).ok().map(Path::to_path_buf)
        })?;
    let parts: Vec<String> = rel
        .components()
        .map(|c| c.as_os_str().to_string_lossy().into_owned())
        .collect();
    (!parts.is_empty()).then(|| parts.join("/"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mem() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        conn
    }

    /// artist_images as shipped before the `browse_mode` column was dropped.
    const LEGACY_ARTIST_IMAGES: &str = "CREATE TABLE artist_images (
        artist_key TEXT NOT NULL,
        browse_mode TEXT NOT NULL,
        art_path TEXT NOT NULL,
        PRIMARY KEY (artist_key, browse_mode)
    );";

    fn describe(conn: &Connection) -> Vec<String> {
        let tables: Vec<String> = conn
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        let mut out = Vec::new();
        for table in tables {
            let mut stmt = conn
                .prepare(&format!(
                    "SELECT name, type, \"notnull\", pk FROM pragma_table_info('{table}') ORDER BY name"
                ))
                .unwrap();
            let cols = stmt
                .query_map([], |r| {
                    Ok(format!(
                        "{table}.{} {} notnull={} pk={}",
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, i64>(2)?,
                        r.get::<_, i64>(3)?
                    ))
                })
                .unwrap()
                .collect::<Result<Vec<_>, _>>()
                .unwrap();
            out.extend(cols);
        }
        out
    }

    /// Apply migrations up to and including `target` (used to build fixtures).
    fn migrate_to(conn: &Connection, target: i64) {
        apply_pending(conn, schema_version(conn).unwrap(), target).unwrap();
    }

    fn fixtures_dir() -> std::path::PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/db")
    }

    fn table_counts(conn: &Connection) -> Vec<(String, i64)> {
        let tables: Vec<String> = conn
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        tables
            .into_iter()
            .map(|t| {
                let n = conn
                    .query_row(&format!("SELECT COUNT(*) FROM {t}"), [], |r| r.get(0))
                    .unwrap();
                (t, n)
            })
            .collect()
    }

    fn upsert_artist_image(conn: &Connection, key: &str, path: &str) {
        conn.execute(
            "INSERT INTO artist_images (artist_key, art_path) VALUES (?1, ?2)
             ON CONFLICT(artist_key) DO UPDATE SET art_path = excluded.art_path",
            params![key, path],
        )
        .unwrap();
    }

    #[test]
    fn fresh_database_reaches_latest_version() {
        let conn = mem();
        run(&conn, None).unwrap();
        assert_eq!(schema_version(&conn).unwrap(), latest_version());
        upsert_artist_image(&conn, "a", "/x.png");
        upsert_artist_image(&conn, "a", "/y.png");
    }

    #[test]
    fn run_is_idempotent() {
        let conn = mem();
        run(&conn, None).unwrap();
        let before = describe(&conn);
        run(&conn, None).unwrap();
        assert_eq!(describe(&conn), before);
    }

    #[test]
    fn legacy_artist_images_key_is_rebuilt_and_data_kept() {
        let conn = mem();
        conn.execute_batch(LEGACY_ARTIST_IMAGES).unwrap();
        conn.execute_batch(
            "INSERT INTO artist_images VALUES ('a', 'artist', '/old.png');
             INSERT INTO artist_images VALUES ('a', 'album_artist', '/newer.png');
             INSERT INTO artist_images VALUES ('b', 'artist', '/b.png');",
        )
        .unwrap();

        run(&conn, None).unwrap();

        let rows: Vec<(String, String)> = conn
            .prepare("SELECT artist_key, art_path FROM artist_images ORDER BY artist_key")
            .unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(
            rows,
            vec![
                ("a".into(), "/newer.png".into()),
                ("b".into(), "/b.png".into())
            ]
        );
        upsert_artist_image(&conn, "a", "/saved.png");
    }

    #[test]
    fn upgraded_legacy_database_matches_fresh_schema() {
        let fresh = mem();
        run(&fresh, None).unwrap();

        let legacy = mem();
        legacy
            .execute_batch(
                "CREATE TABLE tracks (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title TEXT NOT NULL,
                    artist TEXT,
                    album TEXT,
                    album_artist TEXT,
                    track_number INTEGER,
                    disc_number INTEGER,
                    year INTEGER,
                    genre TEXT,
                    duration_seconds REAL,
                    file_path TEXT NOT NULL UNIQUE,
                    art_path TEXT
                );
                CREATE TABLE playlists (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title TEXT NOT NULL,
                    description TEXT,
                    date_created TEXT NOT NULL,
                    last_used_at TEXT NOT NULL
                );",
            )
            .unwrap();
        legacy.execute_batch(LEGACY_ARTIST_IMAGES).unwrap();
        run(&legacy, None).unwrap();

        // Same columns/keys regardless of upgrade path (column order may differ
        // because upgraded tables gain columns via ALTER TABLE).
        assert_eq!(describe(&legacy), describe(&fresh));
    }

    /// Schema versions from here on get a fixture once a newer version exists:
    /// a snapshot of the database as that version left it, so the migration
    /// out of it is tested against realistic data. Earlier versions were never
    /// released and have none.
    const FIRST_FIXTURE_VERSION: i64 = 2;

    /// Regenerate a fixture: `FIXTURE_VERSION=2 cargo test --lib
    /// generate_db_fixture -- --ignored`. Builds the schema by running
    /// migrations 1..=N, loads `seed/v<N>.sql`, and writes `v<N>.sql`.
    #[test]
    #[ignore = "writes tests/fixtures/db/v<N>.sql; run on demand"]
    fn generate_db_fixture() {
        let version: i64 = std::env::var("FIXTURE_VERSION")
            .expect("set FIXTURE_VERSION=<schema version>")
            .parse()
            .unwrap();
        let seed = std::fs::read_to_string(fixtures_dir().join(format!("seed/v{version}.sql")))
            .unwrap_or_else(|e| panic!("missing seed/v{version}.sql: {e}"));

        let conn = mem();
        migrate_to(&conn, version);
        assert_eq!(schema_version(&conn).unwrap(), version);
        conn.execute_batch(&seed)
            .unwrap_or_else(|e| panic!("seed/v{version}.sql does not fit schema {version}: {e}"));

        let ddl: Vec<String> = conn
            .prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        let out = format!(
            "-- Generated fixture for schema version {version}. Do not edit; see \
             docs/contributing/database-migrations.md.\nPRAGMA user_version = {version};\n{};\n{seed}",
            ddl.join(";\n")
        );
        std::fs::write(fixtures_dir().join(format!("v{version}.sql")), out).unwrap();
    }

    #[test]
    fn fixture_exists_for_every_older_schema_version() {
        for version in FIRST_FIXTURE_VERSION..latest_version() {
            assert!(
                fixtures_dir().join(format!("v{version}.sql")).exists(),
                "schema version {version} has a newer version but no fixture. Copy \
                 tests/fixtures/db/seed/v<previous>.sql to seed/v{version}.sql, adjust it for schema {version}, then run: \
                 FIXTURE_VERSION={version} cargo test --lib generate_db_fixture -- --ignored \
                 (see docs/contributing/database-migrations.md)"
            );
        }
    }

    /// Each fixture is a database as an older schema version left it. It must
    /// upgrade to the latest schema without losing rows or drifting from a
    /// fresh database.
    #[test]
    fn every_fixture_upgrades_to_the_fresh_schema_without_data_loss() {
        let mut fixtures: Vec<_> = std::fs::read_dir(fixtures_dir())
            .unwrap()
            .map(|e| e.unwrap().path())
            .filter(|p| p.extension().is_some_and(|e| e == "sql"))
            .collect();
        fixtures.sort();

        let fresh = mem();
        run(&fresh, None).unwrap();
        let expected_schema = describe(&fresh);

        for path in fixtures {
            let name = path.file_name().unwrap().to_string_lossy().to_string();
            let conn = Connection::open_in_memory().unwrap();
            // Dumps list tables in creation order but FKs are off to be safe.
            conn.execute_batch("PRAGMA foreign_keys = OFF;").unwrap();
            conn.execute_batch(&std::fs::read_to_string(&path).unwrap())
                .unwrap_or_else(|e| panic!("{name}: fixture failed to load: {e}"));
            conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();

            let from = schema_version(&conn).unwrap();
            assert!(from > 0, "{name}: fixture must set PRAGMA user_version");
            let before = table_counts(&conn);

            run(&conn, None).unwrap_or_else(|e| panic!("{name}: upgrade failed: {e}"));

            assert_eq!(schema_version(&conn).unwrap(), latest_version(), "{name}");
            assert_eq!(describe(&conn), expected_schema, "{name}: schema drift");
            let integrity: String = conn
                .query_row("PRAGMA integrity_check", [], |r| r.get(0))
                .unwrap();
            assert_eq!(integrity, "ok", "{name}");
            check_foreign_keys(&conn).unwrap_or_else(|e| panic!("{name}: {e}"));
            // A migration that intentionally changes row counts must adjust
            // this assertion for the versions it affects. v3 adds `sources`
            // with its two built-in rows.
            let mut expected = before.clone();
            if from < 3 {
                expected.push(("sources".to_string(), 2));
                expected.sort();
            }
            assert_eq!(table_counts(&conn), expected, "{name}: rows changed");
        }
    }

    fn load_fixture(version: i64) -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            &std::fs::read_to_string(fixtures_dir().join(format!("v{version}.sql"))).unwrap(),
        )
        .unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        conn
    }

    #[test]
    fn v3_seeds_sources_and_assigns_existing_tracks_to_external() {
        let conn = load_fixture(2);
        conn.execute("DELETE FROM tracks WHERE id = 2", []).unwrap();
        let tracks_before: Vec<(i64, String, String)> = conn
            .prepare("SELECT id, title, file_path FROM tracks ORDER BY id")
            .unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();

        // Stop at v3, with foreign keys off for the rebuild as `run` does.
        conn.execute_batch("PRAGMA foreign_keys = OFF;").unwrap();
        migrate_to(&conn, 3);
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();

        let sources: Vec<(i64, String, Option<String>, bool)> = conn
            .prepare("SELECT id, kind, root_path, writable FROM sources ORDER BY id")
            .unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(
            sources,
            vec![
                (1, "managed".into(), None, true),
                (2, "external".into(), None, false)
            ]
        );

        let tracks_after: Vec<(i64, String, String, i64, Option<String>)> = conn
            .prepare(
                "SELECT id, title, file_path, source_id, missing_since FROM tracks ORDER BY id",
            )
            .unwrap()
            .query_map([], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
            })
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(tracks_after.len(), tracks_before.len());
        for ((id, title, path), after) in tracks_before.into_iter().zip(tracks_after) {
            assert_eq!(after, (id, title, path, 2, None));
        }

        // Children still point at their tracks, and deleting cascades.
        let lyrics: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM track_lyrics WHERE track_id = 1",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(lyrics, 1);
        conn.execute("DELETE FROM tracks WHERE id = 1", []).unwrap();
        let orphans: i64 = conn
            .query_row(
                "SELECT (SELECT COUNT(*) FROM track_lyrics) + (SELECT COUNT(*) FROM listen_events)
                      + (SELECT COUNT(*) FROM playlist_tracks)",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(orphans, 0);

        // Ids of tracks deleted before the rebuild are not reused.
        conn.execute(
            "INSERT INTO tracks (title, file_path, date_added, source_id) VALUES ('New', '/n.mp3', 'now', 2)",
            [],
        )
        .unwrap();
        assert_eq!(conn.last_insert_rowid(), 3);
    }

    #[test]
    fn v4_adds_empty_file_stat_columns_and_keeps_sources() {
        let conn = load_fixture(3);
        run(&conn, None).unwrap();
        type Row = (i64, i64, Option<String>, Option<i64>, Option<i64>);
        let rows: Vec<Row> = conn
            .prepare(
                "SELECT id, source_id, missing_since, file_size, file_mtime_ms
                 FROM tracks ORDER BY id",
            )
            .unwrap()
            .query_map([], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
            })
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(
            rows,
            vec![
                (1, 2, None, None, None),
                (2, 2, None, None, None),
                (3, 3, Some("2024-02-01T00:00:00Z".into()), None, None),
            ]
        );
    }

    fn sources_rows(conn: &Connection) -> Vec<(i64, String, Option<String>, bool, bool)> {
        conn.prepare(
            "SELECT id, name, root_path, auto_organize, import_target FROM sources ORDER BY id",
        )
        .unwrap()
        .query_map([], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
        })
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap()
    }

    fn track_locations(conn: &Connection) -> Vec<(i64, i64, String)> {
        conn.prepare("SELECT id, source_id, rel_path FROM tracks ORDER BY id")
            .unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap()
    }

    #[test]
    fn v5_makes_sources_uniform_and_track_paths_relative() {
        let conn = load_fixture(4);
        crate::sources::attach_spiral_folder(&conn, Path::new("/library")).unwrap();
        run(&conn, None).unwrap();

        assert_eq!(
            sources_rows(&conn),
            vec![
                (1, "Spiral Library".into(), None, true, true),
                (2, "Other Files".into(), None, false, false),
                (
                    3,
                    "Collection".into(),
                    Some("/collection".into()),
                    false,
                    false
                ),
            ]
        );
        assert!(!table_columns(&conn, "sources")
            .unwrap()
            .iter()
            .any(|c| c == "kind" || c == "writable"));

        assert_eq!(
            track_locations(&conn),
            vec![
                // External tracks are Other's, by absolute path.
                (1, 2, "/music/a.mp3".into()),
                (2, 2, "/music/b.mp3".into()),
                // Watched tracks are relative to their folder.
                (3, 3, "Sub/c.flac".into()),
                // Managed tracks are relative to the Spiral folder's Tracks.
                (4, 1, "Artist Z/Album 3/d.mp3".into()),
                // A watched track outside its folder falls back to Other.
                (5, 2, "/elsewhere/e.mp3".into()),
            ]
        );

        // Everything else about the rows survived the rebuild.
        type Kept = (
            String,
            Option<String>,
            Option<i64>,
            Option<i64>,
            Option<String>,
        );
        let kept: Vec<Kept> = conn
            .prepare(
                "SELECT title, missing_since, file_size, file_mtime_ms, recording_mbid
                 FROM tracks WHERE id IN (1, 3, 4) ORDER BY id",
            )
            .unwrap()
            .query_map([], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
            })
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(
            kept,
            vec![
                (
                    "Song A".into(),
                    None,
                    None,
                    None,
                    Some("11111111-1111-1111-1111-111111111111".into())
                ),
                (
                    "Song C".into(),
                    Some("2024-02-01T00:00:00Z".into()),
                    Some(2048),
                    Some(1700000000000),
                    None
                ),
                ("Song D".into(), None, Some(4096), Some(1700000000001), None),
            ]
        );

        // The resolver turns them back into the same absolute paths.
        let paths: Vec<String> = crate::db::get_all_tracks(&conn)
            .unwrap()
            .into_iter()
            .map(|t| t.file_path.replace('\\', "/"))
            .collect();
        for expected in [
            "/music/a.mp3",
            "/music/b.mp3",
            "/collection/Sub/c.flac",
            "/library/Tracks/Artist Z/Album 3/d.mp3",
            "/elsewhere/e.mp3",
        ] {
            assert!(
                paths.iter().any(|p| p == expected),
                "{expected} in {paths:?}"
            );
        }

        // Ids of removed folders are not reused; children still cascade.
        conn.execute(
            "INSERT INTO sources (name, root_path, created_at) VALUES ('New', '/new', 'now')",
            [],
        )
        .unwrap();
        assert_eq!(conn.last_insert_rowid(), 5);
        conn.execute("DELETE FROM tracks WHERE id = 4", []).unwrap();
        let orphans: i64 = conn
            .query_row(
                "SELECT (SELECT COUNT(*) FROM track_lyrics WHERE track_id = 4)
                      + (SELECT COUNT(*) FROM listen_events WHERE track_id = 4)
                      + (SELECT COUNT(*) FROM playlist_tracks WHERE track_id = 4)",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(orphans, 0);
    }

    #[test]
    fn v5_without_a_spiral_folder_keeps_default_paths_absolute() {
        let conn = load_fixture(4);
        run(&conn, None).unwrap();
        let locations = track_locations(&conn);
        assert_eq!(
            locations[3],
            (4, 1, "/library/Tracks/Artist Z/Album 3/d.mp3".into())
        );
        assert_eq!(locations[2], (3, 3, "Sub/c.flac".into()));
    }

    #[test]
    fn v5_upgrades_a_library_on_disk_when_opened() {
        let dir = std::env::temp_dir().join(format!(
            "spiral-migrate-v5-{}-{}",
            std::process::id(),
            Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        std::fs::create_dir_all(dir.join("Tracks")).unwrap();
        let db_path = dir.join("Library.db");
        let managed = dir.join("Tracks").join("Artist Z").join("d.mp3");
        {
            let conn = Connection::open(&db_path).unwrap();
            conn.execute_batch(&std::fs::read_to_string(fixtures_dir().join("v4.sql")).unwrap())
                .unwrap();
            conn.execute(
                "UPDATE tracks SET file_path = ?1 WHERE id = 4",
                params![managed.to_string_lossy()],
            )
            .unwrap();
        }

        let conn = crate::db::open(&db_path).unwrap();
        assert_eq!(schema_version(&conn).unwrap(), latest_version());
        assert_eq!(track_locations(&conn)[3], (4, 1, "Artist Z/d.mp3".into()));
        let track = crate::db::get_track_by_id(&conn, 4).unwrap().unwrap();
        assert_eq!(track.file_path, managed.to_string_lossy());
        assert!(dir.join("Library.db.bak-v4").is_file());
        drop(conn);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn database_from_newer_app_is_rejected_untouched() {
        let conn = mem();
        conn.execute_batch(&format!("PRAGMA user_version = {}", latest_version() + 1))
            .unwrap();
        let err = run(&conn, None).unwrap_err().to_string();
        assert!(err.contains("update Spiral"), "{err}");
        assert!(!table_exists(&conn, "tracks").unwrap());
    }

    #[test]
    fn failed_migration_rolls_back_and_keeps_previous_version() {
        let conn = mem();
        run(&conn, None).unwrap();
        // Break v2's precondition: a view named like its scratch table makes
        // the rebuild fail after it has already dropped nothing yet.
        conn.execute_batch("PRAGMA user_version = 1; DROP TABLE artist_images;")
            .unwrap();
        conn.execute_batch(LEGACY_ARTIST_IMAGES).unwrap();
        conn.execute_batch("INSERT INTO artist_images VALUES ('a', 'artist', '/a.png');")
            .unwrap();
        conn.execute_batch("CREATE TABLE artist_images_new (x INTEGER);")
            .unwrap();

        assert!(run(&conn, None).is_err());
        assert_eq!(schema_version(&conn).unwrap(), 1);
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM artist_images", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn existing_file_database_is_backed_up_before_migrating() {
        let dir = std::env::temp_dir().join(format!("spiral-migrate-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("Library.db");
        let _ = std::fs::remove_file(dir.join("Library.db.bak-v0"));
        let _ = std::fs::remove_file(&path);

        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(LEGACY_ARTIST_IMAGES).unwrap();
        conn.execute_batch("CREATE TABLE tracks (id INTEGER PRIMARY KEY, title TEXT NOT NULL, file_path TEXT NOT NULL UNIQUE, date_added TEXT NOT NULL);
                            CREATE TABLE playlists (id INTEGER PRIMARY KEY, title TEXT NOT NULL, description TEXT, date_created TEXT NOT NULL, last_used_at TEXT NOT NULL);").unwrap();
        run(&conn, Some(&path)).unwrap();

        let backup = Connection::open(dir.join("Library.db.bak-v0")).unwrap();
        assert!(table_columns(&backup, "artist_images")
            .unwrap()
            .contains(&"browse_mode".to_string()));
        drop(backup);
        drop(conn);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
