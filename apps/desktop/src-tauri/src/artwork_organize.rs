//! Move / prune library Artwork trees when album, artist, or playlist identity changes.

use crate::artwork_extract::prune_empty_album_artwork_dir;
use crate::artwork_paths::{
    self, album_artwork_dir, art_path_is_override, artist_artwork_dir, ensure_inside_album_artwork,
    ensure_inside_artist_artwork, find_portrait_image, playlist_artwork_path_stem,
    resolve_library_relative, to_library_relative,
};
use crate::library_organize;
use rusqlite::Connection;
use std::fs;
use std::path::{Path, PathBuf};

/// Rename `Artwork/albums/{old…}` → `{new…}` and rewrite relative `tracks.art_path` prefixes.
pub fn rename_album_artwork_dir(
    conn: &Connection,
    library_root: &Path,
    old_album_artist: Option<&str>,
    old_artist: Option<&str>,
    old_album: Option<&str>,
    new_album_artist: Option<&str>,
    new_artist: Option<&str>,
    new_album: Option<&str>,
) -> Result<(), String> {
    let old_dir = album_artwork_dir(library_root, old_album_artist, old_artist, old_album);
    let new_dir = album_artwork_dir(library_root, new_album_artist, new_artist, new_album);
    if same_path(&old_dir, &new_dir) {
        return Ok(());
    }
    if !old_dir.is_dir() {
        return Ok(());
    }
    ensure_inside_album_artwork(library_root, &old_dir)?;
    ensure_inside_album_artwork(library_root, &new_dir)?;

    if new_dir.exists() {
        // Destination already has art (e.g. mid-save). Merge missing files; keep dest on conflict.
        merge_dir_contents(&old_dir, &new_dir)?;
        let _ = fs::remove_dir_all(&old_dir);
        prune_parent_album_dirs(library_root, &old_dir);
    } else {
        if let Some(parent) = new_dir.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::rename(&old_dir, &new_dir)
            .map_err(|e| format!("failed to rename album artwork dir: {e}"))?;
        prune_parent_album_dirs(library_root, &old_dir);
    }

    let Some(old_rel) = to_library_relative(library_root, &old_dir) else {
        return Ok(());
    };
    let Some(new_rel) = to_library_relative(library_root, &new_dir) else {
        return Ok(());
    };
    rewrite_art_path_prefix(conn, &old_rel, &new_rel)?;
    Ok(())
}

/// After a single track's album identity changes: move shared dir when this was the last
/// track on the old album; otherwise move only that track's override file.
pub fn reconcile_track_album_artwork(
    conn: &Connection,
    library_root: &Path,
    track_id: i64,
    old_album_artist: Option<&str>,
    old_artist: Option<&str>,
    old_album: Option<&str>,
    new_album_artist: Option<&str>,
    new_artist: Option<&str>,
    new_album: Option<&str>,
    current_art_path: Option<&str>,
) -> Result<Option<String>, String> {
    let old_dir = album_artwork_dir(library_root, old_album_artist, old_artist, old_album);
    let new_dir = album_artwork_dir(library_root, new_album_artist, new_artist, new_album);
    if same_path(&old_dir, &new_dir) {
        return Ok(normalize_stored_override(library_root, current_art_path));
    }

    let others = count_other_tracks_with_album_identity(
        conn,
        track_id,
        old_album_artist,
        old_artist,
        old_album,
    )?;

    if others == 0 {
        rename_album_artwork_dir(
            conn,
            library_root,
            old_album_artist,
            old_artist,
            old_album,
            new_album_artist,
            new_artist,
            new_album,
        )?;
        // Prefix rewrite already ran; re-read this track's path if needed.
        if let Some(rel) = current_art_path.map(str::trim).filter(|s| !s.is_empty()) {
            if let (Some(old_rel), Some(new_rel)) = (
                to_library_relative(library_root, &old_dir),
                to_library_relative(library_root, &new_dir),
            ) {
                if let Some(suffix) = strip_art_prefix(rel, &old_rel) {
                    return Ok(Some(format!("{new_rel}/{suffix}")));
                }
            }
        }
        return Ok(normalize_stored_override(library_root, current_art_path));
    }

    // Other tracks still on the old album — only move this track's override.
    let Some(art) = current_art_path.map(str::trim).filter(|s| !s.is_empty()) else {
        return Ok(None);
    };
    if !art_path_is_override(Some(art)) {
        return Ok(None);
    }

    let src = if Path::new(art).is_absolute() {
        Some(PathBuf::from(art))
    } else {
        resolve_library_relative(library_root, art)
    };
    let Some(src) = src.filter(|p| p.is_file()) else {
        return Ok(normalize_stored_override(library_root, Some(art)));
    };

    fs::create_dir_all(&new_dir).map_err(|e| e.to_string())?;
    let file_name = src
        .file_name()
        .ok_or_else(|| "override art missing file name".to_string())?;
    let dest = new_dir.join(file_name);
    if dest.exists() && dest != src {
        let same = fs::read(&src)
            .ok()
            .zip(fs::read(&dest).ok())
            .map(|(a, b)| a == b)
            .unwrap_or(false);
        if !same {
            // Keep destination; drop orphaned source if unreferenced after move attempt skip.
            let _ = src;
        } else {
            let _ = fs::remove_file(&src);
        }
    } else if dest != src {
        fs::rename(&src, &dest)
            .or_else(|_| {
                fs::copy(&src, &dest)
                    .map(|_| ())
                    .and_then(|_| fs::remove_file(&src))
            })
            .map_err(|e| format!("failed to move override art: {e}"))?;
    }

    let _ = prune_empty_album_artwork_dir(library_root, &old_dir);
    Ok(to_library_relative(library_root, &dest))
}

pub fn rename_artist_artwork_dir(
    library_root: &Path,
    old_key: &str,
    new_key: &str,
) -> Result<Option<String>, String> {
    if old_key.trim() == new_key.trim() {
        return Ok(None);
    }
    let old_dir = artist_artwork_dir(library_root, old_key);
    let new_dir = artist_artwork_dir(library_root, new_key);
    if !old_dir.is_dir() {
        return Ok(
            find_portrait_image(&new_dir).and_then(|p| to_library_relative(library_root, &p))
        );
    }
    if same_path(&old_dir, &new_dir) {
        return Ok(
            find_portrait_image(&old_dir).and_then(|p| to_library_relative(library_root, &p))
        );
    }
    ensure_inside_artist_artwork(library_root, &old_dir)?;
    ensure_inside_artist_artwork(library_root, &new_dir)?;
    if new_dir.exists() {
        merge_dir_contents(&old_dir, &new_dir)?;
        let _ = fs::remove_dir_all(&old_dir);
    } else {
        if let Some(parent) = new_dir.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::rename(&old_dir, &new_dir)
            .map_err(|e| format!("failed to rename artist artwork dir: {e}"))?;
    }
    Ok(find_portrait_image(&new_dir).and_then(|p| to_library_relative(library_root, &p)))
}

pub fn rename_playlist_artwork_file(
    library_root: &Path,
    playlist_id: i64,
    old_title: &str,
    new_title: &str,
    current_relative_or_abs: Option<&str>,
) -> Result<Option<String>, String> {
    if old_title.trim() == new_title.trim() {
        return Ok(current_relative_or_abs.and_then(|p| {
            if Path::new(p).is_absolute() {
                to_library_relative(library_root, Path::new(p))
            } else {
                Some(p.to_string())
            }
        }));
    }

    let old_stem = playlist_artwork_path_stem(library_root, playlist_id, old_title);
    let new_stem = playlist_artwork_path_stem(library_root, playlist_id, new_title);

    let src = current_relative_or_abs
        .and_then(|p| {
            if Path::new(p).is_absolute() {
                Some(PathBuf::from(p))
            } else {
                resolve_library_relative(library_root, p)
            }
        })
        .filter(|p| p.is_file())
        .or_else(|| artwork_paths::find_playlist_display_for_stem(&old_stem));

    let Some(src) = src else {
        return Ok(None);
    };
    let ext = src.extension().and_then(|e| e.to_str()).unwrap_or("jpg");
    if let Some(parent) = new_stem.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let dest = PathBuf::from(format!("{}.{ext}", new_stem.to_string_lossy()));
    rename_art_file(&src, &dest)?;

    Ok(to_library_relative(library_root, &dest))
}

fn rename_art_file(src: &Path, dest: &Path) -> Result<(), String> {
    if src == dest {
        return Ok(());
    }
    if dest.exists() {
        let _ = fs::remove_file(dest);
    }
    fs::rename(src, dest)
        .or_else(|_| {
            fs::copy(src, dest)
                .map(|_| ())
                .and_then(|_| fs::remove_file(src))
        })
        .map_err(|e| format!("failed to rename playlist art: {e}"))
}

/// Delete every cover file for this playlist. Names are `{id}-{title}.{ext}`, so the
/// id prefix includes the hyphen and does not match a longer id (`1-` vs `10-`).
pub fn remove_playlist_artwork(library_root: &Path, playlist_id: i64) -> Result<(), String> {
    let dir = artwork_paths::artwork_root(library_root).join(artwork_paths::PLAYLISTS_DIR);
    if !dir.is_dir() {
        return Ok(());
    }
    let prefix = format!("{playlist_id}-");
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with(&prefix) && entry.path().is_file() {
            fs::remove_file(entry.path())
                .map_err(|e| format!("failed to remove playlist artwork {name}: {e}"))?;
        }
    }
    Ok(())
}

/// Delete an override file when no other track references it; never delete shared front.jpg
/// while the album still has tracks. Prune empty album artwork dirs.
pub fn gc_art_after_track_removed(
    conn: &Connection,
    library_root: &Path,
    removed: &crate::models::Track,
) -> Result<(), String> {
    gc_unreferenced_override_file(conn, library_root, removed.art_path.as_deref())?;

    let album_dir = album_artwork_dir(
        library_root,
        removed.album_artist.as_deref(),
        removed.artist.as_deref(),
        removed.album.as_deref(),
    );
    let remaining = count_tracks_with_album_identity(
        conn,
        removed.album_artist.as_deref(),
        removed.artist.as_deref(),
        removed.album.as_deref(),
    )?;
    ensure_inside_album_artwork(library_root, &album_dir)?;
    if remaining == 0 {
        if album_dir.is_dir() {
            let _ = fs::remove_dir_all(&album_dir);
            prune_parent_album_dirs(library_root, &album_dir);
        }
    } else {
        let _ = prune_empty_album_artwork_dir(library_root, &album_dir);
    }
    Ok(())
}

/// After a track stops pointing at an override file, delete that file when nothing else
/// references it. Safe no-op for `front.*` / missing paths.
pub fn gc_unreferenced_override_file(
    conn: &Connection,
    library_root: &Path,
    previous_art_path: Option<&str>,
) -> Result<(), String> {
    let Some(art) = previous_art_path.map(str::trim).filter(|s| !s.is_empty()) else {
        return Ok(());
    };
    if !art_path_is_override(Some(art)) {
        return Ok(());
    }

    let rel = if Path::new(art).is_absolute() {
        to_library_relative(library_root, Path::new(art)).unwrap_or_else(|| art.to_string())
    } else {
        art.replace('\\', "/")
    };

    let refs = count_art_path_refs(conn, &rel)?;
    // Also count absolute form if still stored that way.
    let refs = if Path::new(art).is_absolute() && art != rel {
        refs + count_art_path_refs(conn, art)?
    } else {
        refs
    };
    if refs > 0 {
        return Ok(());
    }

    let path = if Path::new(art).is_absolute() {
        PathBuf::from(art)
    } else {
        let Some(path) = resolve_library_relative(library_root, &rel) else {
            eprintln!("artwork gc: refusing non-library path {rel}");
            return Ok(());
        };
        path
    };
    // Overrides only ever live in an album artwork dir; never delete a stored path elsewhere.
    if let Err(err) = ensure_inside_album_artwork(library_root, &path) {
        eprintln!("artwork gc: {err}");
        return Ok(());
    }
    if path.is_file() {
        let _ = fs::remove_file(&path);
        if let Some(parent) = path.parent() {
            let _ = prune_empty_album_artwork_dir(library_root, parent);
        }
    }
    Ok(())
}

fn normalize_stored_override(library_root: &Path, art: Option<&str>) -> Option<String> {
    let art = art?.trim();
    if art.is_empty() || !art_path_is_override(Some(art)) {
        return None;
    }
    if Path::new(art).is_absolute() {
        to_library_relative(library_root, Path::new(art)).or_else(|| Some(art.to_string()))
    } else {
        Some(art.to_string())
    }
}

fn rewrite_art_path_prefix(conn: &Connection, old_rel: &str, new_rel: &str) -> Result<(), String> {
    if old_rel == new_rel {
        return Ok(());
    }
    let old_slash = old_rel.replace('\\', "/");
    let new_slash = new_rel.replace('\\', "/");
    let rows: Vec<(i64, String)> = {
        let mut stmt = conn
            .prepare("SELECT id, art_path FROM tracks WHERE art_path IS NOT NULL")
            .map_err(|e| e.to_string())?;
        let iter = stmt
            .query_map([], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?;
        iter.filter_map(|r| r.ok()).collect()
    };
    for (id, path) in rows {
        let normalized = path.replace('\\', "/");
        if let Some(suffix) = strip_art_prefix(&normalized, &old_slash) {
            let updated = format!("{new_slash}/{suffix}");
            conn.execute(
                "UPDATE tracks SET art_path = ?1 WHERE id = ?2",
                rusqlite::params![updated, id],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn strip_art_prefix<'a>(path: &'a str, prefix: &str) -> Option<&'a str> {
    let path = path.trim_start_matches('/');
    let prefix = prefix.trim_start_matches('/');
    let rest = path.strip_prefix(prefix)?;
    Some(rest.trim_start_matches('/'))
}

fn merge_dir_contents(src: &Path, dest: &Path) -> Result<(), String> {
    fs::create_dir_all(dest).map_err(|e| e.to_string())?;
    for entry in fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let to = dest.join(entry.file_name());
        if entry.path().is_dir() {
            merge_dir_contents(&entry.path(), &to)?;
        } else if !to.exists() {
            fs::copy(entry.path(), &to).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Remove the now-empty artist dir above an album dir. Never walks above `Artwork/albums`.
fn prune_parent_album_dirs(library_root: &Path, removed_album_dir: &Path) {
    let Some(artist_dir) = removed_album_dir.parent() else {
        return;
    };
    if ensure_inside_album_artwork(library_root, artist_dir).is_err() {
        return;
    }
    if artist_dir.is_dir() {
        if fs::read_dir(artist_dir)
            .map(|mut d| d.next().is_none())
            .unwrap_or(false)
        {
            let _ = fs::remove_dir(artist_dir);
        }
    }
}

fn same_path(a: &Path, b: &Path) -> bool {
    library_organize::same_path(a, b)
}

fn album_identity_key(
    album_artist: Option<&str>,
    artist: Option<&str>,
    album: Option<&str>,
) -> (String, String) {
    (
        artwork_paths::album_artist_for_path(album_artist, artist),
        artwork_paths::album_title_for_path(album),
    )
}

fn count_other_tracks_with_album_identity(
    conn: &Connection,
    exclude_id: i64,
    album_artist: Option<&str>,
    artist: Option<&str>,
    album: Option<&str>,
) -> Result<usize, String> {
    let target = album_identity_key(album_artist, artist, album);
    let mut stmt = conn
        .prepare("SELECT id, album_artist, artist, album FROM tracks WHERE id != ?1")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![exclude_id], |row| {
            Ok((
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    let mut count = 0usize;
    for row in rows.flatten() {
        let key = album_identity_key(row.0.as_deref(), row.1.as_deref(), row.2.as_deref());
        if key == target {
            count += 1;
        }
    }
    Ok(count)
}

fn count_tracks_with_album_identity(
    conn: &Connection,
    album_artist: Option<&str>,
    artist: Option<&str>,
    album: Option<&str>,
) -> Result<usize, String> {
    let target = album_identity_key(album_artist, artist, album);
    let mut stmt = conn
        .prepare("SELECT album_artist, artist, album FROM tracks")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, Option<String>>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    Ok(rows
        .flatten()
        .filter(|row| {
            album_identity_key(row.0.as_deref(), row.1.as_deref(), row.2.as_deref()) == target
        })
        .count())
}

fn count_art_path_refs(conn: &Connection, art_path: &str) -> Result<usize, String> {
    let normalized = art_path.replace('\\', "/");
    // Match stored relative paths and any absolute rows that end with the same suffix.
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM tracks WHERE
                replace(COALESCE(art_path, ''), '\\', '/') = ?1
                OR replace(COALESCE(art_path, ''), '\\', '/') LIKE ?2",
            rusqlite::params![
                normalized,
                format!("%/{}", normalized.trim_start_matches('/'))
            ],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(count as usize)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::artwork_paths::{
        override_art_filename, ALBUMS_DIR, ARTISTS_DIR, FRONT_STEM, PORTRAIT_STEM,
    };
    use crate::settings::ARTWORK_DIR_NAME;
    use std::io::Write;

    #[test]
    fn rename_album_dir_moves_front() {
        let root = std::env::temp_dir().join(format!("spiral-art-ren-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();

        let old = album_artwork_dir(&root, Some("A"), None, Some("Old"));
        fs::create_dir_all(&old).unwrap();
        let front = old.join(format!("{FRONT_STEM}.jpg"));
        let mut f = fs::File::create(&front).unwrap();
        write!(f, "art").unwrap();

        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE tracks (
                id INTEGER PRIMARY KEY,
                art_path TEXT,
                album_artist TEXT,
                artist TEXT,
                album TEXT
            );",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO tracks (id, art_path, album_artist, artist, album)
             VALUES (1, NULL, 'A', 'A', 'Old')",
            [],
        )
        .unwrap();

        rename_album_artwork_dir(
            &conn,
            &root,
            Some("A"),
            None,
            Some("Old"),
            Some("A"),
            None,
            Some("New"),
        )
        .unwrap();

        let new = album_artwork_dir(&root, Some("A"), None, Some("New"));
        assert!(new.join(format!("{FRONT_STEM}.jpg")).is_file());
        assert!(!old.exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn reconcile_moves_override_when_siblings_remain() {
        let root = std::env::temp_dir().join(format!("spiral-art-rec-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();

        let old = album_artwork_dir(&root, Some("A"), None, Some("Album"));
        fs::create_dir_all(&old).unwrap();
        fs::write(old.join(format!("{FRONT_STEM}.jpg")), b"front").unwrap();
        let name = override_art_filename(Some(3), "Song", "front", "jpg");
        let override_path = old.join(&name);
        fs::write(&override_path, b"unique").unwrap();
        let rel = to_library_relative(&root, &override_path).unwrap();

        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE tracks (
                id INTEGER PRIMARY KEY,
                art_path TEXT,
                album_artist TEXT,
                artist TEXT,
                album TEXT
            );",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO tracks (id, art_path, album_artist, artist, album) VALUES (1, ?1, 'A', 'A', 'Album')",
            rusqlite::params![rel],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO tracks (id, art_path, album_artist, artist, album) VALUES (2, NULL, 'A', 'A', 'Album')",
            [],
        )
        .unwrap();

        let new_rel = reconcile_track_album_artwork(
            &conn,
            &root,
            1,
            Some("A"),
            Some("A"),
            Some("Album"),
            Some("B"),
            Some("B"),
            Some("Other"),
            Some(&rel),
        )
        .unwrap()
        .unwrap();

        assert!(new_rel.contains("Other"));
        assert!(old.exists(), "sibling album dir should remain");
        let new_dir = album_artwork_dir(&root, Some("B"), Some("B"), Some("Other"));
        assert!(new_dir.join(&name).is_file());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn gc_deletes_unreferenced_override_after_clear() {
        let root = std::env::temp_dir().join(format!("spiral-art-gc-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();

        let album = album_artwork_dir(&root, Some("A"), None, Some("Album"));
        fs::create_dir_all(&album).unwrap();
        fs::write(album.join(format!("{FRONT_STEM}.jpg")), b"front").unwrap();
        let name = override_art_filename(Some(3), "Song", "front", "jpg");
        let override_path = album.join(&name);
        fs::write(&override_path, b"unique").unwrap();
        let rel = to_library_relative(&root, &override_path).unwrap();

        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE tracks (
                id INTEGER PRIMARY KEY,
                art_path TEXT,
                album_artist TEXT,
                artist TEXT,
                album TEXT
            );",
        )
        .unwrap();
        // Track already cleared to canonical (NULL) — override unreferenced.
        conn.execute(
            "INSERT INTO tracks (id, art_path, album_artist, artist, album)
             VALUES (1, NULL, 'A', 'A', 'Album')",
            [],
        )
        .unwrap();

        gc_unreferenced_override_file(&conn, &root, Some(&rel)).unwrap();
        assert!(!override_path.exists(), "override file should be deleted");
        assert!(
            album.join(format!("{FRONT_STEM}.jpg")).is_file(),
            "front.jpg must remain"
        );
        let _ = fs::remove_dir_all(&root);
    }

    fn dot_tag_library(label: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "spiral-art-dots-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("Tracks")).unwrap();
        fs::write(root.join("Library.db"), b"db").unwrap();
        fs::write(root.join("Tracks").join("song.mp3"), b"audio").unwrap();
        let other = album_artwork_dir(&root, Some("Other"), None, Some("Album"));
        fs::create_dir_all(&other).unwrap();
        fs::write(other.join(format!("{FRONT_STEM}.jpg")), b"front").unwrap();
        root
    }

    fn tracks_table() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE tracks (
                id INTEGER PRIMARY KEY,
                art_path TEXT,
                album_artist TEXT,
                artist TEXT,
                album TEXT
            );",
        )
        .unwrap();
        conn
    }

    fn assert_library_intact(root: &Path) {
        assert!(root.join("Library.db").is_file(), "Library.db must survive");
        assert!(root.join("Tracks").join("song.mp3").is_file());
        assert!(album_artwork_dir(root, Some("Other"), None, Some("Album"))
            .join(format!("{FRONT_STEM}.jpg"))
            .is_file());
        assert!(root.join(ARTWORK_DIR_NAME).join(ALBUMS_DIR).is_dir());
    }

    #[test]
    fn gc_with_dot_tags_stays_inside_album_artwork() {
        for dots in [".", "..", "...", ". ."] {
            let root = dot_tag_library("gc");
            let dir = album_artwork_dir(&root, Some(dots), Some(dots), Some(dots));
            fs::create_dir_all(&dir).unwrap();
            fs::write(dir.join(format!("{FRONT_STEM}.jpg")), b"front").unwrap();

            let removed = crate::models::Track {
                id: 1,
                title: dots.to_string(),
                artist: Some(dots.to_string()),
                album: Some(dots.to_string()),
                album_artist: Some(dots.to_string()),
                ..Default::default()
            };
            gc_art_after_track_removed(&tracks_table(), &root, &removed).unwrap();

            assert_library_intact(&root);
            assert!(
                !dir.exists(),
                "{dots:?}: the album's own art dir is collected"
            );
            let _ = fs::remove_dir_all(&root);
        }
    }

    #[test]
    fn rename_album_with_dot_tags_stays_inside_album_artwork() {
        let root = dot_tag_library("rename");
        let dir = album_artwork_dir(&root, Some(".."), None, Some(".."));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(format!("{FRONT_STEM}.jpg")), b"front").unwrap();

        rename_album_artwork_dir(
            &tracks_table(),
            &root,
            Some(".."),
            None,
            Some(".."),
            Some("New"),
            None,
            Some("Album"),
        )
        .unwrap();

        assert_library_intact(&root);
        assert!(album_artwork_dir(&root, Some("New"), None, Some("Album"))
            .join(format!("{FRONT_STEM}.jpg"))
            .is_file());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn gc_never_deletes_override_path_outside_album_artwork() {
        let root = dot_tag_library("override");
        let outside = root.join("Tracks").join("song.mp3");
        let conn = tracks_table();
        gc_unreferenced_override_file(&conn, &root, Some(outside.to_str().unwrap())).unwrap();
        gc_unreferenced_override_file(&conn, &root, Some("Artwork/albums/../../Library.db"))
            .unwrap();
        assert_library_intact(&root);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn remove_playlist_artwork_deletes_only_that_playlist() {
        let root = std::env::temp_dir().join(format!(
            "spiral-art-playlist-rm-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let _ = fs::remove_dir_all(&root);
        let dir = artwork_paths::artwork_root(&root).join(artwork_paths::PLAYLISTS_DIR);
        fs::create_dir_all(&dir).unwrap();
        let own = dir.join("1-Summer.jpg");
        let other = dir.join("10-Summer.jpg");
        fs::write(&own, b"one").unwrap();
        fs::write(&other, b"ten").unwrap();

        remove_playlist_artwork(&root, 1).unwrap();

        assert!(!own.exists());
        assert!(other.is_file(), "playlist 10 art must remain");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn rename_artist_dir_moves_portrait() {
        let root = std::env::temp_dir().join(format!(
            "spiral-art-artist-ren-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();

        let old = artist_artwork_dir(&root, "Fall Out Boy");
        fs::create_dir_all(&old).unwrap();
        let portrait = old.join(format!("{PORTRAIT_STEM}.jpg"));
        fs::write(&portrait, b"art").unwrap();

        let new_rel = rename_artist_artwork_dir(&root, "Fall Out Boy", "The Fall Out Boy")
            .unwrap()
            .unwrap();

        let new_dir = artist_artwork_dir(&root, "The Fall Out Boy");
        assert!(new_dir.join(format!("{PORTRAIT_STEM}.jpg")).is_file());
        assert!(!old.exists());
        assert_eq!(
            new_rel,
            format!("{ARTWORK_DIR_NAME}/{ARTISTS_DIR}/The Fall Out Boy/{PORTRAIT_STEM}.jpg")
        );

        let _ = fs::remove_dir_all(&root);
    }
}
