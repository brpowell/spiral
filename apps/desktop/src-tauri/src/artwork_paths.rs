use crate::ids::PlaylistId;
use crate::library_organize::sanitize_filename;
use crate::settings::ARTWORK_DIR_NAME;
use std::fs;
use std::path::{Component, Path, PathBuf};

pub const ALBUMS_DIR: &str = "albums";
pub const ARTISTS_DIR: &str = "artists";
pub const PLAYLISTS_DIR: &str = "playlists";
pub const FRONT_STEM: &str = "front";
pub const PORTRAIT_STEM: &str = "portrait";
/// The folders under `Artwork/` that hold art.
pub const ARTWORK_SUBDIRS: &[&str] = &[ALBUMS_DIR, ARTISTS_DIR, PLAYLISTS_DIR];

/// English unknown labels — must match organize path fallbacks, not i18n.
pub fn unknown_artist_label() -> &'static str {
    "Unknown Artist"
}

pub fn unknown_album_label() -> &'static str {
    "Unknown Album"
}

pub fn album_artist_for_path(album_artist: Option<&str>, artist: Option<&str>) -> String {
    sanitize_filename(
        album_artist
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .or_else(|| artist.map(str::trim).filter(|s| !s.is_empty()))
            .unwrap_or_else(|| unknown_artist_label()),
    )
}

pub fn album_title_for_path(album: Option<&str>) -> String {
    sanitize_filename(
        album
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| unknown_album_label()),
    )
}

pub fn artwork_root(library_root: &Path) -> PathBuf {
    library_root.join(ARTWORK_DIR_NAME)
}

pub fn album_artwork_dir(
    library_root: &Path,
    album_artist: Option<&str>,
    artist: Option<&str>,
    album: Option<&str>,
) -> PathBuf {
    artwork_root(library_root)
        .join(ALBUMS_DIR)
        .join(album_artist_for_path(album_artist, artist))
        .join(album_title_for_path(album))
}

/// Refuse to touch `target` unless it sits strictly inside `Artwork/{subdir}` (at least one
/// plain component below it). Compared by path components, so `..` cannot slip through.
pub fn ensure_inside_artwork_subdir(
    library_root: &Path,
    subdir: &str,
    target: &Path,
) -> Result<(), String> {
    let base = artwork_root(library_root).join(subdir);
    let inside = target.strip_prefix(&base).is_ok_and(|rest| {
        rest.components().next().is_some()
            && rest
                .components()
                .all(|c| matches!(c, std::path::Component::Normal(_)))
    });
    if inside {
        Ok(())
    } else {
        Err(format!(
            "refusing to modify artwork path outside {}: {}",
            base.display(),
            target.display()
        ))
    }
}

pub fn ensure_inside_album_artwork(library_root: &Path, target: &Path) -> Result<(), String> {
    ensure_inside_artwork_subdir(library_root, ALBUMS_DIR, target)
}

pub fn ensure_inside_artist_artwork(library_root: &Path, target: &Path) -> Result<(), String> {
    ensure_inside_artwork_subdir(library_root, ARTISTS_DIR, target)
}

pub fn artist_artwork_dir(library_root: &Path, artist_key: &str) -> PathBuf {
    artwork_root(library_root)
        .join(ARTISTS_DIR)
        .join(sanitize_filename(artist_key.trim()))
}

pub fn playlist_artwork_filename(playlist_id: &PlaylistId, title: &str) -> String {
    let safe = sanitize_filename(title.trim());
    format!("{playlist_id}-{safe}")
}

pub fn playlist_artwork_path_stem(
    library_root: &Path,
    playlist_id: &PlaylistId,
    title: &str,
) -> PathBuf {
    artwork_root(library_root)
        .join(PLAYLISTS_DIR)
        .join(playlist_artwork_filename(playlist_id, title))
}

/// Relative path under library root using `/` separators. `None` when `absolute` is not
/// under `library_root` or the remainder has anything but plain names (`..`, `.`).
pub fn to_library_relative(library_root: &Path, absolute: &Path) -> Option<String> {
    let rel = absolute.strip_prefix(library_root).ok()?;
    let mut segments = Vec::new();
    for component in rel.components() {
        let Component::Normal(name) = component else {
            return None;
        };
        segments.push(name.to_string_lossy());
    }
    Some(segments.join("/"))
}

/// Absolute path for a library-relative path. `None` when a segment is not a plain
/// name (`..`, `.`, a root or a drive prefix), so the result stays under `library_root`.
pub fn resolve_library_relative(library_root: &Path, relative: &str) -> Option<PathBuf> {
    let mut path = library_root.to_path_buf();
    for segment in relative.split(['/', '\\']).filter(|s| !s.is_empty()) {
        let mut components = Path::new(segment).components();
        match (components.next(), components.next()) {
            (Some(Component::Normal(name)), None) => path.push(name),
            _ => return None,
        }
    }
    Some(path)
}

pub fn ext_from_mime_or_bytes(mime: &str, bytes: &[u8]) -> &'static str {
    let lower = mime.to_ascii_lowercase();
    if lower.contains("png") || bytes_look_like_png(bytes) {
        "png"
    } else if lower.contains("webp") || bytes_look_like_webp(bytes) {
        "webp"
    } else {
        "jpg"
    }
}

fn bytes_look_like_png(bytes: &[u8]) -> bool {
    bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A])
}

fn bytes_look_like_webp(bytes: &[u8]) -> bool {
    bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP"
}

/// `{trackNumber:02} - {title} - {type}.{ext}` for non-canonical album art.
pub fn override_art_filename(
    track_number: Option<i32>,
    title: &str,
    art_type: &str,
    ext: &str,
) -> String {
    let num = track_number
        .map(|n| format!("{n:02}"))
        .unwrap_or_else(|| "00".to_string());
    let title = sanitize_filename(title.trim());
    let art_type = sanitize_filename(art_type.trim());
    let ext = ext.trim().trim_start_matches('.').to_ascii_lowercase();
    let ext = if ext.is_empty() {
        "jpg".to_string()
    } else {
        ext
    };
    format!("{num} - {title} - {art_type}.{ext}")
}

pub fn ensure_artwork_dirs(library_root: &Path) -> Result<(), String> {
    let root = artwork_root(library_root);
    fs::create_dir_all(root.join(ALBUMS_DIR))
        .map_err(|e| format!("failed to create artwork albums dir: {e}"))?;
    fs::create_dir_all(root.join(ARTISTS_DIR))
        .map_err(|e| format!("failed to create artwork artists dir: {e}"))?;
    fs::create_dir_all(root.join(PLAYLISTS_DIR))
        .map_err(|e| format!("failed to create artwork playlists dir: {e}"))?;
    Ok(())
}

/// Resolve a track's front art to a file for display: a copy of its linked
/// image, preferring the one in its album folder. `None` when it has none or
/// every copy is damaged.
pub fn hydrate_track_art_path(
    conn: &rusqlite::Connection,
    library_root: &Path,
    track: &mut crate::models::Track,
) {
    use crate::artwork_registry::{self, ArtworkKind};
    let hash = artwork_registry::track_art(conn, &track.id, ArtworkKind::Front)
        .ok()
        .flatten();
    track.art_path = hash.and_then(|hash| {
        let dir = album_artwork_dir(
            library_root,
            track.album_artist.as_deref(),
            track.artist.as_deref(),
            track.album.as_deref(),
        );
        artwork_registry::resolve(conn, library_root, &hash, Some(&dir))
            .ok()
            .flatten()
            .map(|p| p.to_string_lossy().into_owned())
    });
}

/// [`hydrate_track_art_path`] for many tracks, reading the registry once and
/// checking each file once.
pub fn hydrate_tracks_art_paths(
    conn: &rusqlite::Connection,
    library_root: &Path,
    tracks: &mut [crate::models::Track],
) {
    use crate::artwork_registry::{self, ArtworkKind};
    let (Ok(links), Ok(files)) = (
        artwork_registry::all_track_art(conn, ArtworkKind::Front),
        artwork_registry::all_files(conn),
    ) else {
        return;
    };
    let mut intact: std::collections::HashMap<String, bool> = std::collections::HashMap::new();
    for track in tracks {
        track.art_path = links.get(&track.id).and_then(|hash| {
            let dir = album_artwork_dir(
                library_root,
                track.album_artist.as_deref(),
                track.artist.as_deref(),
                track.album.as_deref(),
            );
            artwork_registry::pick_file(
                files.get(hash).map_or(&[][..], Vec::as_slice),
                library_root,
                Some(&dir),
                &mut |f| {
                    *intact
                        .entry(f.rel_path.clone())
                        .or_insert_with(|| f.is_intact(library_root))
                },
            )
            .map(|p| p.to_string_lossy().into_owned())
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn override_filename_includes_type() {
        assert_eq!(
            override_art_filename(Some(3), "Harder Better", "front", "jpg"),
            "03 - Harder Better - front.jpg"
        );
    }

    #[test]
    fn album_path_uses_unknown_fallbacks() {
        let root = Path::new("/lib");
        let dir = album_artwork_dir(root, None, None, None);
        assert_eq!(
            dir,
            PathBuf::from("/lib/Artwork/albums/Unknown Artist/Unknown Album")
        );
    }

    #[test]
    fn dot_tags_stay_inside_album_artwork() {
        let root = Path::new("/lib");
        let albums = root.join(ARTWORK_DIR_NAME).join(ALBUMS_DIR);
        for dots in [".", "..", "...", ". ."] {
            let dir = album_artwork_dir(root, Some(dots), Some(dots), Some(dots));
            assert_eq!(dir, albums.join("Unknown").join("Unknown"), "{dots:?}");
            assert!(ensure_inside_album_artwork(root, &dir).is_ok());
            let artist = artist_artwork_dir(root, dots);
            assert!(ensure_inside_artist_artwork(root, &artist).is_ok());
        }
    }

    #[test]
    fn containment_guard_rejects_escaping_paths() {
        let root = Path::new("/lib");
        let albums = root.join(ARTWORK_DIR_NAME).join(ALBUMS_DIR);
        assert!(ensure_inside_album_artwork(root, &albums.join("A").join("B")).is_ok());
        assert!(ensure_inside_album_artwork(root, &albums.join("A")).is_ok());
        for bad in [
            albums.clone(),
            albums.join("..").join(".."),
            albums.join("A").join("..").join("..").join(".."),
            root.to_path_buf(),
            root.join("Tracks"),
            PathBuf::from("/"),
            PathBuf::from("/lib/Artwork/albumsX/A"),
            root.join(ARTWORK_DIR_NAME).join(ARTISTS_DIR).join("A"),
        ] {
            assert!(
                ensure_inside_album_artwork(root, &bad).is_err(),
                "{}",
                bad.display()
            );
        }
        assert!(ensure_inside_artist_artwork(root, &albums.join("A")).is_err());
    }

    #[test]
    fn resolve_library_relative_keeps_plain_segments() {
        let root = Path::new("/lib");
        assert_eq!(
            resolve_library_relative(root, "Artwork/albums\\a/front.jpg"),
            Some(PathBuf::from("/lib/Artwork/albums/a/front.jpg"))
        );
    }

    #[test]
    fn resolve_library_relative_rejects_dot_segments() {
        let root = Path::new("/lib");
        assert_eq!(resolve_library_relative(root, "../etc/passwd"), None);
        assert_eq!(resolve_library_relative(root, "Artwork/../../x"), None);
        assert_eq!(resolve_library_relative(root, "Artwork\\..\\x"), None);
        assert_eq!(resolve_library_relative(root, "./front.jpg"), None);
    }

    #[test]
    fn to_library_relative_rejects_dot_segments() {
        let root = Path::new("/lib");
        assert_eq!(
            to_library_relative(root, Path::new("/lib/Artwork/a.jpg")),
            Some("Artwork/a.jpg".to_string())
        );
        assert_eq!(
            to_library_relative(root, Path::new("/lib/../etc/passwd")),
            None
        );
        assert_eq!(to_library_relative(root, Path::new("/other/a.jpg")), None);
    }
}
