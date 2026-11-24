//! The artwork registry: which image each track, artist and playlist shows,
//! and where copies of each image live under the Spiral folder's `Artwork/`.
//!
//! An image is its bytes, named by their SHA-256 (`artwork`). Entities link to
//! an image by kind (`track_artwork`, `artist_artwork`, `playlist_artwork`), so
//! every art change is a row change the change log sees. Files are copies kept
//! for display (`artwork_file`); several may share an image.
//!
//! `Artwork/` belongs to Spiral, and the database decides which art an entity
//! has: the folder is never scanned to find art. A recorded file that is gone,
//! or whose size or modified time changed, is damaged and never taken as new
//! art. Front art can be rebuilt from a track's embedded picture
//! ([`crate::artwork_extract::repair_front_art`]); any other damaged image
//! shows the placeholder.

use crate::artwork_paths::{resolve_library_relative, to_library_relative, ARTWORK_SUBDIRS};
use crate::ids::{PlaylistId, TrackId};
use crate::settings::ARTWORK_DIR_NAME;
use rusqlite::{params, Connection, OptionalExtension};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

/// What an image is for. Stored as text with no constraint, so a new kind is
/// a variant here, not a migration.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ArtworkKind {
    /// A track's front cover (album art).
    Front,
    /// An artist's portrait.
    Portrait,
    /// A playlist's custom cover.
    Cover,
}

/// A picture slot in an audio file's tags.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EmbeddedPicture {
    CoverFront,
}

impl ArtworkKind {
    pub const ALL: [ArtworkKind; 3] = [Self::Front, Self::Portrait, Self::Cover];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Front => "front",
            Self::Portrait => "portrait",
            Self::Cover => "cover",
        }
    }

    /// The kind stored as `value`, or `None` for one this version doesn't know.
    #[cfg(test)]
    pub fn parse(value: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|kind| kind.as_str() == value)
    }

    /// The embedded picture that holds a track's art of this kind, when audio
    /// files carry it. Art with a picture is written into the files and can be
    /// rebuilt from them; art without one exists only in `Artwork/`. Another
    /// kind (`back`, …) is an entry here plus its extract and embed calls.
    pub fn embedded_picture(self) -> Option<EmbeddedPicture> {
        match self {
            Self::Front => Some(EmbeddedPicture::CoverFront),
            Self::Portrait | Self::Cover => None,
        }
    }
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

/// The MIME type of image `bytes`, from their signature.
pub fn mime_for(bytes: &[u8]) -> &'static str {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        "image/png"
    } else if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        "image/webp"
    } else if bytes.starts_with(b"GIF8") {
        "image/gif"
    } else if bytes.starts_with(b"BM") {
        "image/bmp"
    } else {
        "image/jpeg"
    }
}

/// Width and height from the image header, without decoding the image.
fn dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    image::ImageReader::new(std::io::Cursor::new(bytes))
        .with_guessed_format()
        .ok()?
        .into_dimensions()
        .ok()
}

/// A recorded copy of an image, relative to the Spiral folder.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArtworkFile {
    pub rel_path: String,
    pub hash: String,
    pub size: i64,
    pub mtime_ms: i64,
}

impl ArtworkFile {
    pub fn path(&self, library_root: &Path) -> Option<PathBuf> {
        resolve_library_relative(library_root, &self.rel_path)
    }

    /// The file is there with the size and modified time recorded for it.
    pub fn is_intact(&self, library_root: &Path) -> bool {
        self.path(library_root)
            .and_then(|path| file_stat(&path))
            .is_some_and(|stat| stat == (self.size, self.mtime_ms))
    }

    fn file_name(&self) -> &str {
        self.rel_path.rsplit('/').next().unwrap_or(&self.rel_path)
    }

    /// `front.*`, the album folder's shared front.
    pub fn is_album_front(&self) -> bool {
        self.file_name()
            .rsplit_once('.')
            .is_some_and(|(stem, _)| stem.eq_ignore_ascii_case(crate::artwork_paths::FRONT_STEM))
    }
}

fn file_stat(path: &Path) -> Option<(i64, i64)> {
    let meta = fs::metadata(path).ok().filter(|m| m.is_file())?;
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_millis() as i64);
    Some((meta.len() as i64, mtime))
}

fn db_err(e: rusqlite::Error) -> String {
    e.to_string()
}

/// `path` relative to the Spiral folder, refusing anything outside `Artwork/`.
fn artwork_rel_path(library_root: &Path, path: &Path) -> Result<String, String> {
    let rel = to_library_relative(library_root, path)
        .filter(|rel| {
            rel.strip_prefix(ARTWORK_DIR_NAME)
                .and_then(|rest| rest.strip_prefix('/'))
                .is_some_and(|rest| {
                    ARTWORK_SUBDIRS
                        .iter()
                        .any(|d| rest.starts_with(&format!("{d}/")))
                })
        })
        .ok_or_else(|| format!("refusing artwork outside Artwork/: {}", path.display()))?;
    Ok(rel)
}

/// Record `bytes`, which Spiral has just written to `path`, as an image and
/// `path` as a copy of it. Returns the image's hash.
pub fn register(
    conn: &Connection,
    library_root: &Path,
    path: &Path,
    bytes: &[u8],
) -> Result<String, String> {
    let rel_path = artwork_rel_path(library_root, path)?;
    let (size, mtime_ms) =
        file_stat(path).ok_or_else(|| format!("artwork file is missing: {}", path.display()))?;
    let hash = sha256_hex(bytes);
    let (width, height) = dimensions(bytes).unzip();
    conn.execute(
        "INSERT OR IGNORE INTO artwork (hash, mime, width, height, byte_size)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![hash, mime_for(bytes), width, height, bytes.len() as i64],
    )
    .map_err(db_err)?;
    conn.execute(
        "INSERT INTO artwork_file (rel_path, hash, size, mtime_ms) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(rel_path) DO UPDATE SET
            hash = excluded.hash, size = excluded.size, mtime_ms = excluded.mtime_ms",
        params![rel_path, hash, size, mtime_ms],
    )
    .map_err(db_err)?;
    Ok(hash)
}

/// Write `bytes` to `path` (inside `Artwork/`) and [`register`] it.
pub fn store(
    conn: &Connection,
    library_root: &Path,
    path: &Path,
    bytes: &[u8],
) -> Result<String, String> {
    artwork_rel_path(library_root, path)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create {}: {e}", parent.display()))?;
    }
    fs::write(path, bytes).map_err(|e| format!("failed to write {}: {e}", path.display()))?;
    register(conn, library_root, path, bytes)
}

fn map_file(row: &rusqlite::Row<'_>) -> rusqlite::Result<ArtworkFile> {
    Ok(ArtworkFile {
        rel_path: row.get(0)?,
        hash: row.get(1)?,
        size: row.get(2)?,
        mtime_ms: row.get(3)?,
    })
}

pub fn files_for_hash(conn: &Connection, hash: &str) -> Result<Vec<ArtworkFile>, String> {
    conn.prepare(
        "SELECT rel_path, hash, size, mtime_ms FROM artwork_file WHERE hash = ?1 ORDER BY rel_path",
    )
    .and_then(|mut stmt| stmt.query_map([hash], map_file)?.collect())
    .map_err(db_err)
}

pub fn file_at(conn: &Connection, rel_path: &str) -> Result<Option<ArtworkFile>, String> {
    conn.query_row(
        "SELECT rel_path, hash, size, mtime_ms FROM artwork_file WHERE rel_path = ?1",
        [rel_path],
        map_file,
    )
    .optional()
    .map_err(db_err)
}

/// `LIKE` pattern for paths below `rel_dir`.
fn below(rel_dir: &str) -> String {
    let escaped = rel_dir
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_");
    format!("{escaped}/%")
}

/// Recorded files anywhere below `dir`.
pub fn files_under(
    conn: &Connection,
    library_root: &Path,
    dir: &Path,
) -> Result<Vec<ArtworkFile>, String> {
    let Some(rel_dir) = to_library_relative(library_root, dir) else {
        return Ok(Vec::new());
    };
    conn.prepare(
        "SELECT rel_path, hash, size, mtime_ms FROM artwork_file
         WHERE rel_path LIKE ?1 ESCAPE '\\' ORDER BY rel_path",
    )
    .and_then(|mut stmt| stmt.query_map([below(&rel_dir)], map_file)?.collect())
    .map_err(db_err)
}

/// Recorded files directly in `dir`.
pub fn files_in(
    conn: &Connection,
    library_root: &Path,
    dir: &Path,
) -> Result<Vec<ArtworkFile>, String> {
    let Some(rel_dir) = to_library_relative(library_root, dir) else {
        return Ok(Vec::new());
    };
    let mut files = files_under(conn, library_root, dir)?;
    files.retain(|f| !f.rel_path[rel_dir.len() + 1..].contains('/'));
    Ok(files)
}

/// Every recorded file, by image.
pub fn all_files(conn: &Connection) -> Result<HashMap<String, Vec<ArtworkFile>>, String> {
    let files: Vec<ArtworkFile> = conn
        .prepare("SELECT rel_path, hash, size, mtime_ms FROM artwork_file ORDER BY rel_path")
        .and_then(|mut stmt| stmt.query_map([], map_file)?.collect())
        .map_err(db_err)?;
    let mut by_hash: HashMap<String, Vec<ArtworkFile>> = HashMap::new();
    for file in files {
        by_hash.entry(file.hash.clone()).or_default().push(file);
    }
    Ok(by_hash)
}

/// The intact copy of an image to show: one in `preferred_dir` (the entity's
/// own folder) when there is one, else any. `intact` answers (and may cache)
/// whether a file is intact.
pub fn pick_file(
    files: &[ArtworkFile],
    library_root: &Path,
    preferred_dir: Option<&Path>,
    intact: &mut dyn FnMut(&ArtworkFile) -> bool,
) -> Option<PathBuf> {
    let preferred_rel = preferred_dir.and_then(|dir| to_library_relative(library_root, dir));
    let in_preferred = |f: &&ArtworkFile| {
        preferred_rel.as_deref().is_some_and(|dir| {
            f.rel_path
                .strip_prefix(dir)
                .is_some_and(|rest| rest.starts_with('/') && !rest[1..].contains('/'))
        })
    };
    let preferred = files.iter().filter(in_preferred);
    let others = files.iter().filter(|f| !in_preferred(f));
    preferred
        .chain(others)
        .find(|f| intact(f))
        .and_then(|f| f.path(library_root))
}

/// Where image `hash` can be shown from, preferring `preferred_dir`.
pub fn resolve(
    conn: &Connection,
    library_root: &Path,
    hash: &str,
    preferred_dir: Option<&Path>,
) -> Result<Option<PathBuf>, String> {
    let files = files_for_hash(conn, hash)?;
    Ok(pick_file(&files, library_root, preferred_dir, &mut |f| {
        f.is_intact(library_root)
    }))
}

// Links. Each write goes through the change-log triggers. Setting a link to
// the image it has already changes nothing.

fn set_link(
    conn: &Connection,
    table: &str,
    key_column: &str,
    key: &dyn rusqlite::ToSql,
    kind: ArtworkKind,
    hash: Option<&str>,
) -> Result<(), String> {
    match hash {
        Some(hash) => conn.execute(
            &format!(
                "INSERT INTO {table} ({key_column}, kind, artwork_hash) VALUES (?1, ?2, ?3)
                 ON CONFLICT({key_column}, kind) DO UPDATE SET artwork_hash = excluded.artwork_hash
                 WHERE artwork_hash IS NOT excluded.artwork_hash"
            ),
            params![key, kind.as_str(), hash],
        ),
        None => conn.execute(
            &format!("DELETE FROM {table} WHERE {key_column} = ?1 AND kind = ?2"),
            params![key, kind.as_str()],
        ),
    }
    .map(|_| ())
    .map_err(db_err)
}

fn get_link(
    conn: &Connection,
    table: &str,
    key_column: &str,
    key: &dyn rusqlite::ToSql,
    kind: ArtworkKind,
) -> Result<Option<String>, String> {
    conn.query_row(
        &format!("SELECT artwork_hash FROM {table} WHERE {key_column} = ?1 AND kind = ?2"),
        params![key, kind.as_str()],
        |row| row.get(0),
    )
    .optional()
    .map_err(db_err)
}

pub fn track_art(
    conn: &Connection,
    track_id: &TrackId,
    kind: ArtworkKind,
) -> Result<Option<String>, String> {
    get_link(conn, "track_artwork", "track_id", track_id, kind)
}

/// Link (or with `None`, unlink) a track's art. Leaves the old image for
/// [`prune`].
pub fn set_track_art(
    conn: &Connection,
    track_id: &TrackId,
    kind: ArtworkKind,
    hash: Option<&str>,
) -> Result<(), String> {
    set_link(conn, "track_artwork", "track_id", track_id, kind, hash)
}

/// Every track's art of `kind`, by track id.
pub fn all_track_art(
    conn: &Connection,
    kind: ArtworkKind,
) -> Result<HashMap<TrackId, String>, String> {
    conn.prepare("SELECT track_id, artwork_hash FROM track_artwork WHERE kind = ?1")
        .and_then(|mut stmt| {
            stmt.query_map([kind.as_str()], |row| Ok((row.get(0)?, row.get(1)?)))?
                .collect()
        })
        .map_err(db_err)
}

/// Tracks linking `hash` as `kind`.
pub fn tracks_with_art(
    conn: &Connection,
    kind: ArtworkKind,
    hash: &str,
) -> Result<Vec<TrackId>, String> {
    conn.prepare(
        "SELECT track_id FROM track_artwork WHERE kind = ?1 AND artwork_hash = ?2
         ORDER BY track_id",
    )
    .and_then(|mut stmt| {
        stmt.query_map(params![kind.as_str(), hash], |row| row.get(0))?
            .collect()
    })
    .map_err(db_err)
}

pub fn artist_art(
    conn: &Connection,
    artist_key: &str,
    kind: ArtworkKind,
) -> Result<Option<String>, String> {
    get_link(conn, "artist_artwork", "artist_key", &artist_key, kind)
}

pub fn set_artist_art(
    conn: &Connection,
    artist_key: &str,
    kind: ArtworkKind,
    hash: Option<&str>,
) -> Result<(), String> {
    set_link(
        conn,
        "artist_artwork",
        "artist_key",
        &artist_key,
        kind,
        hash,
    )
}

/// Every artist's art of `kind`, ordered by key.
pub fn all_artist_art(
    conn: &Connection,
    kind: ArtworkKind,
) -> Result<Vec<(String, String)>, String> {
    conn.prepare(
        "SELECT artist_key, artwork_hash FROM artist_artwork WHERE kind = ?1 ORDER BY artist_key",
    )
    .and_then(|mut stmt| {
        stmt.query_map([kind.as_str()], |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect()
    })
    .map_err(db_err)
}

/// Move every link of `old_key` to `new_key`, replacing what `new_key` had.
/// Each moved link is a delete and an insert, so the log has a tombstone for
/// the old key.
pub fn rename_artist(conn: &Connection, old_key: &str, new_key: &str) -> Result<(), String> {
    if old_key == new_key {
        return Ok(());
    }
    for kind in ArtworkKind::ALL {
        if let Some(hash) = artist_art(conn, old_key, kind)? {
            set_artist_art(conn, old_key, kind, None)?;
            set_artist_art(conn, new_key, kind, Some(&hash))?;
        }
    }
    Ok(())
}

pub fn playlist_art(
    conn: &Connection,
    playlist_id: &PlaylistId,
    kind: ArtworkKind,
) -> Result<Option<String>, String> {
    get_link(conn, "playlist_artwork", "playlist_id", playlist_id, kind)
}

pub fn set_playlist_art(
    conn: &Connection,
    playlist_id: &PlaylistId,
    kind: ArtworkKind,
    hash: Option<&str>,
) -> Result<(), String> {
    set_link(
        conn,
        "playlist_artwork",
        "playlist_id",
        playlist_id,
        kind,
        hash,
    )
}

/// Delete a recorded file, from disk too when it is still the image recorded.
pub fn remove_file(
    conn: &Connection,
    library_root: &Path,
    file: &ArtworkFile,
) -> Result<(), String> {
    if file.is_intact(library_root) {
        if let Some(path) = file.path(library_root) {
            fs::remove_file(&path)
                .map_err(|e| format!("failed to remove {}: {e}", path.display()))?;
            prune_empty_dirs(library_root, &path);
        }
    }
    conn.execute(
        "DELETE FROM artwork_file WHERE rel_path = ?1",
        [&file.rel_path],
    )
    .map_err(db_err)?;
    Ok(())
}

/// Delete every image nothing links to, with its files. Called after art
/// links change and after a scan. Returns how many images went.
pub fn prune(conn: &Connection, library_root: &Path) -> Result<usize, String> {
    let unlinked: Vec<String> = conn
        .prepare(
            "SELECT hash FROM artwork a
             WHERE NOT EXISTS (SELECT 1 FROM track_artwork WHERE artwork_hash = a.hash)
               AND NOT EXISTS (SELECT 1 FROM artist_artwork WHERE artwork_hash = a.hash)
               AND NOT EXISTS (SELECT 1 FROM playlist_artwork WHERE artwork_hash = a.hash)",
        )
        .and_then(|mut stmt| stmt.query_map([], |row| row.get(0))?.collect())
        .map_err(db_err)?;
    for hash in &unlinked {
        for file in files_for_hash(conn, hash)? {
            if let Err(err) = remove_file(conn, library_root, &file) {
                eprintln!("artwork prune: {err}");
                conn.execute(
                    "DELETE FROM artwork_file WHERE rel_path = ?1",
                    [&file.rel_path],
                )
                .map_err(db_err)?;
            }
        }
        conn.execute("DELETE FROM artwork WHERE hash = ?1", [hash])
            .map_err(db_err)?;
    }
    Ok(unlinked.len())
}

/// Remove folders left empty above `removed`, up to (not including)
/// `Artwork/<albums|artists|playlists>`.
pub fn prune_empty_dirs(library_root: &Path, removed: &Path) {
    let artwork = library_root.join(ARTWORK_DIR_NAME);
    let mut dir = removed.parent();
    while let Some(current) = dir {
        let Ok(rest) = current.strip_prefix(&artwork) else {
            return;
        };
        if rest.components().count() < 2 {
            return;
        }
        let empty = fs::read_dir(current).is_ok_and(|mut d| d.next().is_none());
        if !empty || fs::remove_dir(current).is_err() {
            return;
        }
        dir = current.parent();
    }
}

/// Move a recorded file to `dest` on disk and in the registry. A recorded
/// file already at `dest` with the same image takes its place; one with
/// another image makes this move pick a free name next to it.
pub fn move_file(
    conn: &Connection,
    library_root: &Path,
    file: &ArtworkFile,
    dest: &Path,
) -> Result<PathBuf, String> {
    let src = file
        .path(library_root)
        .ok_or_else(|| format!("bad artwork path {}", file.rel_path))?;
    let mut dest = dest.to_path_buf();
    let dest_rel = artwork_rel_path(library_root, &dest)?;
    if dest_rel == file.rel_path {
        return Ok(dest);
    }
    if let Some(existing) = file_at(conn, &dest_rel)? {
        if existing.hash == file.hash && existing.is_intact(library_root) {
            remove_file(conn, library_root, file)?;
            return Ok(dest);
        }
        if existing.hash != file.hash {
            dest = free_name(conn, library_root, &dest, &file.hash)?;
        }
    }
    if !file.is_intact(library_root) {
        // Nothing to move; the record follows so a repair writes it there.
        conn.execute(
            "UPDATE artwork_file SET rel_path = ?1 WHERE rel_path = ?2",
            params![artwork_rel_path(library_root, &dest)?, file.rel_path],
        )
        .map_err(db_err)?;
        return Ok(dest);
    }
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    if fs::rename(&src, &dest).is_err() {
        fs::copy(&src, &dest)
            .and_then(|_| fs::remove_file(&src))
            .map_err(|e| format!("failed to move {}: {e}", src.display()))?;
    }
    prune_empty_dirs(library_root, &src);
    let (size, mtime_ms) = file_stat(&dest).unwrap_or((file.size, file.mtime_ms));
    conn.execute(
        "INSERT OR REPLACE INTO artwork_file (rel_path, hash, size, mtime_ms) VALUES (?1, ?2, ?3, ?4)",
        params![artwork_rel_path(library_root, &dest)?, file.hash, size, mtime_ms],
    )
    .map_err(db_err)?;
    conn.execute(
        "DELETE FROM artwork_file WHERE rel_path = ?1",
        [&file.rel_path],
    )
    .map_err(db_err)?;
    Ok(dest)
}

/// Move every recorded file below `from` to the same place below `to`. Links
/// don't change. Files under `from` that aren't recorded are left.
pub fn move_dir(
    conn: &Connection,
    library_root: &Path,
    from: &Path,
    to: &Path,
) -> Result<(), String> {
    let Some(from_rel) = to_library_relative(library_root, from) else {
        return Ok(());
    };
    for file in files_under(conn, library_root, from)? {
        let rest = &file.rel_path[from_rel.len() + 1..];
        let dest = rest.split('/').fold(to.to_path_buf(), |p, s| p.join(s));
        move_file(conn, library_root, &file, &dest)?;
    }
    Ok(())
}

/// After Spiral copied `Artwork/` itself (moving the Spiral folder to another
/// volume), take each copy's new modified time, for files whose bytes are
/// still the image recorded. Returns how many were updated.
pub fn restat_copied_files(conn: &Connection, library_root: &Path) -> Result<usize, String> {
    let mut updated = 0;
    for file in all_files(conn)?.into_values().flatten() {
        let Some(path) = file.path(library_root) else {
            continue;
        };
        let Some((size, mtime_ms)) = file_stat(&path) else {
            continue;
        };
        if (size, mtime_ms) == (file.size, file.mtime_ms) || size != file.size {
            continue;
        }
        if fs::read(&path).is_ok_and(|bytes| sha256_hex(&bytes) == file.hash) {
            conn.execute(
                "UPDATE artwork_file SET mtime_ms = ?1 WHERE rel_path = ?2",
                params![mtime_ms, file.rel_path],
            )
            .map_err(db_err)?;
            updated += 1;
        }
    }
    Ok(updated)
}

/// `dest`, or `dest` with a short hash added to its stem when another image is
/// recorded there.
pub fn free_name(
    conn: &Connection,
    library_root: &Path,
    dest: &Path,
    hash: &str,
) -> Result<PathBuf, String> {
    let taken = |path: &Path| -> Result<bool, String> {
        let rel = artwork_rel_path(library_root, path)?;
        Ok(file_at(conn, &rel)?.is_some_and(|f| f.hash != hash))
    };
    if !taken(dest)? {
        return Ok(dest.to_path_buf());
    }
    let stem = dest
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("art")
        .to_string();
    let ext = dest.extension().and_then(|s| s.to_str()).unwrap_or("jpg");
    let alt = dest.with_file_name(format!("{stem}-{}.{ext}", &hash[..8]));
    Ok(alt)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kinds_round_trip_and_only_front_is_embedded() {
        for kind in ArtworkKind::ALL {
            assert_eq!(ArtworkKind::parse(kind.as_str()), Some(kind));
            assert!(!kind.as_str().contains(':'));
        }
        assert_eq!(ArtworkKind::parse("back"), None);
        assert_eq!(
            ArtworkKind::Front.embedded_picture(),
            Some(EmbeddedPicture::CoverFront)
        );
        assert_eq!(ArtworkKind::Portrait.embedded_picture(), None);
        assert_eq!(ArtworkKind::Cover.embedded_picture(), None);
    }

    #[test]
    fn like_pattern_escapes_wildcards() {
        assert_eq!(
            below("Artwork/albums/50%_off"),
            "Artwork/albums/50\\%\\_off/%"
        );
    }
}
