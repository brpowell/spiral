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
//!
//! Full process: `apps/desktop/docs/contributing/database-migrations.md`.

use chrono::Utc;
use rusqlite::{params, Connection};
use std::path::Path;

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
    let result = apply_pending(conn, current);
    if foreign_keys {
        conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    }
    result
}

fn apply_pending(conn: &Connection, current: i64) -> Result<(), rusqlite::Error> {
    for migration in MIGRATIONS.iter().filter(|m| m.version > current) {
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
