//! Telling when two track paths are the same file on disk.
//!
//! Path strings are not enough: APFS and most Windows volumes ignore case and
//! Unicode normalization, so `Song.mp3` and `song.mp3` (or an NFC and an NFD
//! spelling) can name one file. Paths are first matched by [`path_key`], then
//! confirmed with the file system ([`same_file`]), so two different files on a
//! case-sensitive volume are never treated as one.

use crate::sources::SourceRoots;
use rusqlite::{params, Connection};
use std::collections::HashMap;
use std::path::Path;
use unicode_normalization::UnicodeNormalization;

/// A key equal for every spelling of a path a case- and
/// normalization-insensitive volume treats as the same: NFC, then lowercase.
pub fn path_key(path: &str) -> String {
    path.nfc().collect::<String>().to_lowercase()
}

/// True when both paths name the same existing file (device and inode, or
/// the platform's equivalent).
pub fn same_file(a: &Path, b: &Path) -> bool {
    same_file::is_same_file(a, b).unwrap_or(false)
}

/// Track rows other than `except` whose path names the same file as `path`.
/// Empty when `path` doesn't exist.
pub fn other_rows_for_file(
    conn: &Connection,
    path: &Path,
    except: i64,
) -> rusqlite::Result<Vec<i64>> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    // Rows only match by file name, so a source root reached another way (a
    // symlink, another spelling of a folder) still compares by inode.
    let name_key = path.file_name().map(|n| path_key(&n.to_string_lossy()));
    let roots = SourceRoots::load(conn)?;
    let mut stmt = conn.prepare("SELECT id, source_id, rel_path FROM tracks WHERE id != ?1")?;
    let rows = stmt.query_map(params![except], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, i64>(1)?,
            row.get::<_, String>(2)?,
        ))
    })?;
    let mut ids = Vec::new();
    for row in rows {
        let (id, source_id, rel_path) = row?;
        let other = roots.resolve(source_id, &rel_path);
        let other = Path::new(&other);
        let other_name = other.file_name().map(|n| path_key(&n.to_string_lossy()));
        if other_name == name_key && same_file(other, path) {
            ids.push(id);
        }
    }
    Ok(ids)
}

struct Row {
    id: i64,
    source_id: i64,
    rel_path: String,
    path: String,
    present: bool,
    history: i64,
}

/// Merge track rows that name the same file into one, e.g. a row stored
/// with an older case of the path and the row a scan added for the spelling
/// on disk. The row with the most history (plays, rating, playlist entries,
/// listens, lyrics) is kept; the others' playlist entries, listens and plays
/// move to it, and it takes the path of a row whose file was found. Returns
/// how many rows were removed.
pub fn merge_duplicate_tracks(conn: &Connection) -> rusqlite::Result<usize> {
    let roots = SourceRoots::load(conn)?;
    let mut by_key: HashMap<String, Vec<Row>> = HashMap::new();
    {
        let mut stmt = conn.prepare(
            "SELECT t.id, t.source_id, t.rel_path, t.missing_since IS NULL,
                    t.play_count + (t.rating > 0)
                    + (SELECT COUNT(*) FROM playlist_tracks p WHERE p.track_id = t.id)
                    + (SELECT COUNT(*) FROM listen_events l WHERE l.track_id = t.id)
                    + (SELECT COUNT(*) FROM track_lyrics y WHERE y.track_id = t.id)
             FROM tracks t",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, bool>(3)?,
                row.get::<_, i64>(4)?,
            ))
        })?;
        for row in rows {
            let (id, source_id, rel_path, present, history) = row?;
            let path = roots.resolve(source_id, &rel_path);
            by_key.entry(path_key(&path)).or_default().push(Row {
                id,
                source_id,
                rel_path,
                path,
                present,
                history,
            });
        }
    }

    let mut removed = 0;
    for rows in by_key.into_values().filter(|rows| rows.len() > 1) {
        // Only rows naming the same existing file are merged; on a
        // case-sensitive volume the spellings are different files.
        let Some(anchor) = rows.iter().find(|r| Path::new(&r.path).is_file()) else {
            continue;
        };
        let mut same: Vec<&Row> = rows
            .iter()
            .filter(|r| same_file(Path::new(&r.path), Path::new(&anchor.path)))
            .collect();
        if same.len() < 2 {
            continue;
        }
        // Most history first; then a row whose file was found; then the oldest.
        same.sort_by_key(|r| (-r.history, !r.present, r.id));
        let keep = same[0];
        let spelling = same.iter().find(|r| r.present).copied().unwrap_or(keep);
        let tx = conn.unchecked_transaction()?;
        for drop in &same[1..] {
            merge_into(&tx, keep.id, drop.id)?;
            removed += 1;
        }
        tx.execute(
            "UPDATE tracks SET source_id = ?1, rel_path = ?2 WHERE id = ?3",
            params![spelling.source_id, spelling.rel_path, keep.id],
        )?;
        if same.iter().any(|r| r.present) {
            tx.execute(
                "UPDATE tracks SET missing_since = NULL WHERE id = ?1",
                params![keep.id],
            )?;
        }
        tx.commit()?;
    }
    Ok(removed)
}

/// Move `drop`'s history to `keep` and delete `drop`.
fn merge_into(conn: &Connection, keep: i64, drop: i64) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE tracks SET
            play_count = play_count + (SELECT play_count FROM tracks WHERE id = ?2),
            rating = CASE WHEN rating > 0 THEN rating
                          ELSE (SELECT rating FROM tracks WHERE id = ?2) END,
            last_played_at = MAX(COALESCE(last_played_at, ''),
                                 COALESCE((SELECT last_played_at FROM tracks WHERE id = ?2), '')),
            date_added = MIN(date_added, (SELECT date_added FROM tracks WHERE id = ?2))
         WHERE id = ?1",
        params![keep, drop],
    )?;
    conn.execute(
        "UPDATE tracks SET last_played_at = NULL WHERE id = ?1 AND last_played_at = ''",
        params![keep],
    )?;
    // A playlist holding both keeps the kept row's entry; the other goes with
    // the dropped row.
    conn.execute(
        "UPDATE OR IGNORE playlist_tracks SET track_id = ?1 WHERE track_id = ?2",
        params![keep, drop],
    )?;
    conn.execute(
        "UPDATE listen_events SET track_id = ?1 WHERE track_id = ?2",
        params![keep, drop],
    )?;
    conn.execute(
        "UPDATE OR IGNORE track_lyrics SET track_id = ?1 WHERE track_id = ?2",
        params![keep, drop],
    )?;
    conn.execute("DELETE FROM tracks WHERE id = ?1", params![drop])?;
    Ok(())
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::source_test_support::*;
    use crate::sources::{DEFAULT_SOURCE_ID, OTHER_SOURCE_ID};
    use std::fs;

    #[test]
    fn path_keys_ignore_case_and_normalization() {
        // "é" precomposed (NFC) and as "e" plus a combining accent (NFD).
        assert_eq!(path_key("/A/Caf\u{e9}.mp3"), path_key("/a/cafe\u{301}.MP3"));
        assert_ne!(path_key("/a/one.mp3"), path_key("/a/two.mp3"));
    }

    /// A second name for `file` the way a case-insensitive volume gives one:
    /// a hard link (the same inode under another spelling) where the volume
    /// is case-sensitive.
    pub(crate) fn alias(file: &Path, alias_name: &str) -> std::path::PathBuf {
        let alias = file.with_file_name(alias_name);
        if !alias.exists() {
            fs::hard_link(file, &alias).unwrap();
        }
        alias
    }

    /// Another case of `dir`'s name for the same folder: the folder itself on
    /// a case-insensitive volume, else a symlink (which walks don't follow).
    #[cfg(unix)]
    pub(crate) fn alias_dir(dir: &Path, alias_name: &str) -> std::path::PathBuf {
        let alias = dir.with_file_name(alias_name);
        if !alias.exists() {
            std::os::unix::fs::symlink(dir, &alias).unwrap();
        }
        alias
    }

    #[test]
    fn other_rows_match_by_file_not_by_string() {
        let tmp = TempDir::new("identity-rows");
        let conn = conn();
        let file = tmp.0.join("song.mp3");
        fs::write(&file, b"x").unwrap();
        let upper = alias(&file, "Song.mp3");
        let a = insert_track(&conn, &file.to_string_lossy(), DEFAULT_SOURCE_ID);
        let b = insert_track(&conn, &upper.to_string_lossy(), OTHER_SOURCE_ID);
        let unrelated = tmp.0.join("other.mp3");
        fs::write(&unrelated, b"y").unwrap();
        insert_track(&conn, &unrelated.to_string_lossy(), OTHER_SOURCE_ID);

        assert_eq!(other_rows_for_file(&conn, &file, a).unwrap(), vec![b]);
        assert!(other_rows_for_file(&conn, &unrelated, -1).unwrap().len() == 1);
        assert!(other_rows_for_file(&conn, &tmp.0.join("gone.mp3"), -1)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn duplicate_rows_merge_into_the_one_with_history() {
        let tmp = TempDir::new("identity-merge");
        let conn = conn();
        let source = add_user_source(&conn, &tmp.0);
        let file = tmp.0.join("song.mp3");
        fs::write(&file, b"x").unwrap();
        alias(&file, "Song.mp3");
        // The old row (stale case, marked missing) has the history; the scan
        // added a row for the spelling on disk.
        let old = insert_track(&conn, "Song.mp3", source);
        let new = insert_track(&conn, "song.mp3", source);
        conn.execute_batch(&format!(
            "UPDATE tracks SET play_count = 3, rating = 80, missing_since = 'then' WHERE id = {old};
             UPDATE tracks SET play_count = 1 WHERE id = {new};
             INSERT INTO playlists (title, date_created, last_used_at) VALUES ('P', 'now', 'now');
             INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (1, {old}, 0);
             INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (1, {new}, 1);
             INSERT INTO listen_events (track_id, started_at, ended_at, listened_seconds, completion)
                 VALUES ({new}, 'a', 'b', 1.0, 'complete');"
        ))
        .unwrap();
        // An unrelated file is untouched.
        let other_dir = tmp.dir("Other");
        fs::write(other_dir.join("x.mp3"), b"y").unwrap();
        let unrelated = insert_track(&conn, "Other/x.mp3", source);

        assert_eq!(merge_duplicate_tracks(&conn).unwrap(), 1);
        let (rel, plays, rating, missing): (String, i64, i64, Option<String>) = conn
            .query_row(
                "SELECT rel_path, play_count, rating, missing_since FROM tracks WHERE id = ?1",
                [old],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();
        assert_eq!(
            (rel.as_str(), plays, rating, missing),
            ("song.mp3", 4, 80, None)
        );
        let count = |sql: &str| -> i64 { conn.query_row(sql, [], |r| r.get(0)).unwrap() };
        assert_eq!(count("SELECT COUNT(*) FROM tracks"), 2);
        assert_eq!(
            count(&format!(
                "SELECT COUNT(*) FROM playlist_tracks WHERE track_id = {old}"
            )),
            1
        );
        assert_eq!(
            count(&format!(
                "SELECT COUNT(*) FROM listen_events WHERE track_id = {old}"
            )),
            1
        );
        assert!(crate::db::get_track_by_id(&conn, unrelated)
            .unwrap()
            .is_some());
        // Nothing left to merge.
        assert_eq!(merge_duplicate_tracks(&conn).unwrap(), 0);
    }

    #[test]
    fn same_key_rows_for_different_files_are_left_alone() {
        let tmp = TempDir::new("identity-distinct");
        let conn = conn();
        let source = add_user_source(&conn, &tmp.0);
        fs::write(tmp.0.join("a.mp3"), b"x").unwrap();
        insert_track(&conn, "a.mp3", source);
        // Only differs in case from the first; a separate file where the
        // volume is case-sensitive, missing where it isn't.
        let upper = tmp.0.join("A.mp3");
        if !upper.exists() {
            fs::write(&upper, b"y").unwrap();
        }
        insert_track(&conn, "A.mp3", source);
        let same_volume_file = same_file(&upper, &tmp.0.join("a.mp3"));
        let removed = merge_duplicate_tracks(&conn).unwrap();
        assert_eq!(removed, usize::from(same_volume_file));
    }
}
