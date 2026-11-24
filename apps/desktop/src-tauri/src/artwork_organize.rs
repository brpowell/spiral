//! Move library Artwork folders when album or artist identity changes. Files
//! move on disk and in the artwork registry (`artwork_file.rel_path`); which
//! image each track or artist shows (its link) doesn't change.

use crate::artwork_extract::{place_front, FrontTarget};
use crate::artwork_paths::{
    self, album_artwork_dir, artist_artwork_dir, ensure_inside_album_artwork,
    ensure_inside_artist_artwork,
};
use crate::artwork_registry::{self, files_in, ArtworkKind};
use crate::ids::TrackId;
use crate::library_organize;
use rusqlite::Connection;
use std::fs;
use std::path::{Path, PathBuf};

/// Move `Artwork/albums/{old…}` to `{new…}`: every recorded file in it moves,
/// keeping its name (one whose name is taken by another image gets a free
/// name), and the tracks keep their art.
#[allow(clippy::too_many_arguments)]
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
    ensure_inside_album_artwork(library_root, &old_dir)?;
    ensure_inside_album_artwork(library_root, &new_dir)?;
    artwork_registry::move_dir(conn, library_root, &old_dir, &new_dir)
}

/// After one track's album identity changes: when it was the old album's last
/// track the album folder moves with it; otherwise its front art is placed in
/// the new album's folder (as [`place_front`] does) and the old folder's copy
/// goes when no other track of the old album shows it.
#[allow(clippy::too_many_arguments)]
pub fn reconcile_track_album_artwork(
    conn: &Connection,
    library_root: &Path,
    track_id: &TrackId,
    old_album_artist: Option<&str>,
    old_artist: Option<&str>,
    old_album: Option<&str>,
    new_target: &FrontTarget<'_>,
) -> Result<(), String> {
    let old_dir = album_artwork_dir(library_root, old_album_artist, old_artist, old_album);
    let new_dir = new_target.album_dir(library_root);
    if same_path(&old_dir, &new_dir) {
        return Ok(());
    }
    let old_identity = album_identity_key(old_album_artist, old_artist, old_album);
    let others = album_tracks(conn, &old_identity)?
        .into_iter()
        .filter(|id| id != track_id)
        .count();
    if others == 0 {
        return rename_album_artwork_dir(
            conn,
            library_root,
            old_album_artist,
            old_artist,
            old_album,
            new_target.album_artist,
            new_target.artist,
            new_target.album,
        );
    }

    let Some(hash) = artwork_registry::track_art(conn, track_id, ArtworkKind::Front)? else {
        return Ok(());
    };
    let Some(current) = artwork_registry::resolve(conn, library_root, &hash, Some(&old_dir))?
    else {
        return Ok(());
    };
    let bytes = fs::read(&current).map_err(|e| e.to_string())?;
    place_front(conn, library_root, new_target, &bytes)?;

    let still_shown = album_tracks(conn, &old_identity)?
        .into_iter()
        .filter(|id| id != track_id)
        .any(|id| {
            artwork_registry::track_art(conn, &id, ArtworkKind::Front)
                .ok()
                .flatten()
                .as_deref()
                == Some(hash.as_str())
        });
    if !still_shown {
        for file in files_in(conn, library_root, &old_dir)?
            .into_iter()
            .filter(|f| f.hash == hash)
        {
            artwork_registry::remove_file(conn, library_root, &file)?;
        }
    }
    Ok(())
}

/// After an artist is renamed: move `Artwork/artists/{old}` to `{new}` and
/// move its links to the new key. Returns the portrait to show.
pub fn rename_artist_artwork_dir(
    conn: &Connection,
    library_root: &Path,
    old_key: &str,
    new_key: &str,
) -> Result<Option<PathBuf>, String> {
    let old_dir = artist_artwork_dir(library_root, old_key);
    let new_dir = artist_artwork_dir(library_root, new_key);
    ensure_inside_artist_artwork(library_root, &old_dir)?;
    ensure_inside_artist_artwork(library_root, &new_dir)?;
    if !same_path(&old_dir, &new_dir) {
        artwork_registry::move_dir(conn, library_root, &old_dir, &new_dir)?;
    }
    artwork_registry::rename_artist(conn, old_key, new_key)?;
    artwork_registry::prune(conn, library_root)?;
    let Some(hash) = artwork_registry::artist_art(conn, new_key, ArtworkKind::Portrait)? else {
        return Ok(None);
    };
    artwork_registry::resolve(conn, library_root, &hash, Some(&new_dir))
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

/// Tracks whose tags put them in the album folder named by `identity`.
fn album_tracks(conn: &Connection, identity: &(String, String)) -> Result<Vec<TrackId>, String> {
    let mut stmt = conn
        .prepare("SELECT id, album_artist, artist, album FROM tracks")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, TrackId>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    Ok(rows
        .flatten()
        .filter(|(_, album_artist, artist, album)| {
            album_identity_key(album_artist.as_deref(), artist.as_deref(), album.as_deref())
                == *identity
        })
        .map(|(id, ..)| id)
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::artwork_registry::sha256_hex;
    use crate::source_test_support::{add_managed_source, conn, TempDir};
    use rusqlite::params;

    struct Library {
        tmp: TempDir,
        conn: Connection,
        source: i64,
    }

    impl Library {
        fn new(label: &str) -> Self {
            let tmp = TempDir::new(label);
            let conn = conn();
            crate::sources::attach_spiral_folder(&conn, &tmp.0).unwrap();
            let source = add_managed_source(&conn, &tmp.dir("Tracks"));
            Self { tmp, conn, source }
        }

        fn root(&self) -> &Path {
            &self.tmp.0
        }

        fn track(&self, title: &str, album: &str) -> TrackId {
            let id = TrackId::new();
            self.conn
                .execute(
                    "INSERT INTO tracks (id, title, artist, album, track_number, rel_path,
                                         date_added, source_id)
                     VALUES (?1, ?2, 'A', ?3, 1, ?4, 'now', ?5)",
                    params![
                        id,
                        title,
                        album,
                        format!("{album}/{title}.mp3"),
                        self.source
                    ],
                )
                .unwrap();
            id
        }

        fn place(&self, id: &TrackId, title: &str, album: &str, bytes: &[u8]) {
            let target = FrontTarget {
                track_id: id,
                album_artist: None,
                artist: Some("A"),
                album: Some(album),
                title,
                track_number: Some(1),
            };
            place_front(&self.conn, self.root(), &target, bytes).unwrap();
        }

        fn set_album(&self, id: &TrackId, album: &str) {
            self.conn
                .execute(
                    "UPDATE tracks SET album = ?1 WHERE id = ?2",
                    params![album, id],
                )
                .unwrap();
        }

        fn files(&self) -> Vec<String> {
            let mut files: Vec<String> = artwork_registry::all_files(&self.conn)
                .unwrap()
                .into_values()
                .flatten()
                .map(|f| f.rel_path)
                .collect();
            files.sort();
            files
        }

        fn front(&self, id: &TrackId) -> Option<String> {
            artwork_registry::track_art(&self.conn, id, ArtworkKind::Front).unwrap()
        }

        fn rev(&self) -> i64 {
            self.conn
                .query_row("SELECT rev FROM library_meta", [], |r| r.get(0))
                .unwrap()
        }
    }

    #[test]
    fn renaming_an_album_moves_its_files_and_keeps_links() {
        let lib = Library::new("album-rename");
        let a = lib.track("One", "Old");
        let b = lib.track("Two", "Old");
        lib.place(&a, "One", "Old", b"FRONT");
        lib.place(&b, "Two", "Old", b"OTHER");
        let rev = lib.rev();

        rename_album_artwork_dir(
            &lib.conn,
            lib.root(),
            None,
            Some("A"),
            Some("Old"),
            None,
            Some("A"),
            Some("New"),
        )
        .unwrap();

        assert_eq!(
            lib.files(),
            vec![
                "Artwork/albums/A/New/01 - Two - front.jpg".to_string(),
                "Artwork/albums/A/New/front.jpg".to_string(),
            ]
        );
        assert_eq!(lib.front(&a), Some(sha256_hex(b"FRONT")));
        assert_eq!(lib.front(&b), Some(sha256_hex(b"OTHER")));
        assert_eq!(lib.rev(), rev, "moving files changes no link");
        assert!(lib.root().join("Artwork/albums/A/New/front.jpg").is_file());
        assert!(!lib.root().join("Artwork/albums/A/Old").exists());
    }

    #[test]
    fn a_track_moved_to_another_album_takes_its_art_along() {
        let lib = Library::new("track-move");
        let a = lib.track("One", "Old");
        let b = lib.track("Two", "Old");
        lib.place(&a, "One", "Old", b"FRONT");
        lib.place(&b, "Two", "Old", b"OTHER");
        lib.set_album(&b, "New");
        let target = FrontTarget {
            track_id: &b,
            album_artist: None,
            artist: Some("A"),
            album: Some("New"),
            title: "Two",
            track_number: Some(1),
        };
        reconcile_track_album_artwork(
            &lib.conn,
            lib.root(),
            &b,
            None,
            Some("A"),
            Some("Old"),
            &target,
        )
        .unwrap();
        assert_eq!(
            lib.files(),
            vec![
                "Artwork/albums/A/New/front.jpg".to_string(),
                "Artwork/albums/A/Old/front.jpg".to_string(),
            ]
        );
        assert_eq!(lib.front(&b), Some(sha256_hex(b"OTHER")));
    }

    #[test]
    fn the_last_track_of_an_album_moves_the_whole_folder() {
        let lib = Library::new("last-track");
        let a = lib.track("One", "Old");
        lib.place(&a, "One", "Old", b"FRONT");
        lib.set_album(&a, "New");
        let target = FrontTarget {
            track_id: &a,
            album_artist: None,
            artist: Some("A"),
            album: Some("New"),
            title: "One",
            track_number: Some(1),
        };
        reconcile_track_album_artwork(
            &lib.conn,
            lib.root(),
            &a,
            None,
            Some("A"),
            Some("Old"),
            &target,
        )
        .unwrap();
        assert_eq!(
            lib.files(),
            vec!["Artwork/albums/A/New/front.jpg".to_string()]
        );
        assert_eq!(lib.front(&a), Some(sha256_hex(b"FRONT")));
    }

    #[test]
    fn renaming_an_artist_moves_the_portrait_and_its_link() {
        let lib = Library::new("artist-rename");
        let dir = artist_artwork_dir(lib.root(), "Fall Out Boy");
        fs::create_dir_all(&dir).unwrap();
        let picked = dir.join("portrait.jpg");
        fs::write(&picked, b"PORTRAIT").unwrap();
        crate::artwork_write::set_artist_portrait(
            &lib.conn,
            lib.root(),
            "Fall Out Boy",
            Some(&picked),
        )
        .unwrap();

        let before = lib.rev();
        let shown =
            rename_artist_artwork_dir(&lib.conn, lib.root(), "Fall Out Boy", "The Fall Out Boy")
                .unwrap()
                .unwrap();
        assert_eq!(
            shown,
            lib.root()
                .join("Artwork/artists/The Fall Out Boy/portrait.jpg")
        );
        assert!(lib.rev() > before);
        assert_eq!(
            artwork_registry::artist_art(&lib.conn, "The Fall Out Boy", ArtworkKind::Portrait)
                .unwrap(),
            Some(sha256_hex(b"PORTRAIT"))
        );
        assert_eq!(
            artwork_registry::artist_art(&lib.conn, "Fall Out Boy", ArtworkKind::Portrait).unwrap(),
            None
        );
        let tombstone: i64 = lib
            .conn
            .query_row(
                "SELECT COUNT(*) FROM change_log WHERE entity = 'artist_artwork'
                 AND entity_id = 'Fall Out Boy:portrait' AND op = 'delete'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(tombstone, 1);
    }
}
