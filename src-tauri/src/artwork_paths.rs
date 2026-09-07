use crate::library_organize::sanitize_filename;
use crate::settings::ARTWORK_DIR_NAME;
use std::fs;
use std::path::{Path, PathBuf};

pub const ALBUMS_DIR: &str = "albums";
pub const ARTISTS_DIR: &str = "artists";
pub const PLAYLISTS_DIR: &str = "playlists";
pub const FRONT_STEM: &str = "front";
pub const PORTRAIT_STEM: &str = "portrait";

const IMAGE_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "webp"];

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

pub fn artist_artwork_dir(library_root: &Path, artist_key: &str) -> PathBuf {
    artwork_root(library_root)
        .join(ARTISTS_DIR)
        .join(sanitize_filename(artist_key.trim()))
}

pub fn playlist_artwork_filename(playlist_id: i64, title: &str) -> String {
    let safe = sanitize_filename(title.trim());
    format!("{playlist_id}-{safe}")
}

pub fn playlist_artwork_path_stem(library_root: &Path, playlist_id: i64, title: &str) -> PathBuf {
    artwork_root(library_root)
        .join(PLAYLISTS_DIR)
        .join(playlist_artwork_filename(playlist_id, title))
}

/// Relative path under library root using `/` separators.
pub fn to_library_relative(library_root: &Path, absolute: &Path) -> Option<String> {
    let rel = absolute.strip_prefix(library_root).ok()?;
    Some(
        rel.components()
            .map(|c| c.as_os_str().to_string_lossy())
            .collect::<Vec<_>>()
            .join("/"),
    )
}

pub fn resolve_library_relative(library_root: &Path, relative: &str) -> PathBuf {
    let mut path = library_root.to_path_buf();
    for segment in relative.split(['/', '\\']).filter(|s| !s.is_empty()) {
        path.push(segment);
    }
    path
}

pub fn find_role_image(dir: &Path, stem: &str) -> Option<PathBuf> {
    if !dir.is_dir() {
        return None;
    }
    for ext in IMAGE_EXTENSIONS {
        let candidate = dir.join(format!("{stem}.{ext}"));
        if candidate.is_file() {
            return Some(candidate);
        }
        // jpeg → also accept if stem is front and we wrote .jpeg (we normalize to jpg)
        if *ext == "jpeg" {
            continue;
        }
    }
    // Case-insensitive probe on case-sensitive volumes.
    let entries = fs::read_dir(dir).ok()?;
    let stem_lower = stem.to_ascii_lowercase();
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        let Some((file_stem, ext)) = name.rsplit_once('.') else {
            continue;
        };
        if !IMAGE_EXTENSIONS.iter().any(|e| ext.eq_ignore_ascii_case(e)) {
            continue;
        }
        if file_stem.eq_ignore_ascii_case(&stem_lower) && entry.path().is_file() {
            return Some(entry.path());
        }
    }
    None
}

pub fn find_front_image(album_dir: &Path) -> Option<PathBuf> {
    find_role_image(album_dir, FRONT_STEM)
}

pub fn find_portrait_image(artist_dir: &Path) -> Option<PathBuf> {
    find_role_image(artist_dir, PORTRAIT_STEM)
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

/// Absolute path for display: override relative path, else album front.jpg.
pub fn resolve_track_art_absolute(
    library_root: &Path,
    art_path: Option<&str>,
    album_artist: Option<&str>,
    artist: Option<&str>,
    album: Option<&str>,
) -> Option<PathBuf> {
    if let Some(rel) = art_path.map(str::trim).filter(|s| !s.is_empty()) {
        // Legacy absolute app-data / absolute paths still work until migrated.
        let candidate = if Path::new(rel).is_absolute() {
            PathBuf::from(rel)
        } else {
            resolve_library_relative(library_root, rel)
        };
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    let dir = album_artwork_dir(library_root, album_artist, artist, album);
    find_front_image(&dir)
}

pub fn hydrate_track_art_path(library_root: &Path, track: &mut crate::models::Track) {
    let resolved = resolve_track_art_absolute(
        library_root,
        track.art_path.as_deref(),
        track.album_artist.as_deref(),
        track.artist.as_deref(),
        track.album.as_deref(),
    );
    track.art_path = resolved.map(|p| p.to_string_lossy().into_owned());
}

pub fn hydrate_tracks_art_paths(library_root: &Path, tracks: &mut [crate::models::Track]) {
    for track in tracks {
        hydrate_track_art_path(library_root, track);
    }
}

/// True when the display path is an album override (not front.jpg / missing).
pub fn art_path_is_override(art_path: Option<&str>) -> bool {
    let Some(path) = art_path.map(str::trim).filter(|s| !s.is_empty()) else {
        return false;
    };
    let name = Path::new(path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("");
    let stem = name.rsplit_once('.').map(|(s, _)| s).unwrap_or(name);
    !stem.eq_ignore_ascii_case(FRONT_STEM)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

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
    fn find_front_image_probes_extensions() {
        let dir = std::env::temp_dir().join(format!("spiral-front-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("front.png");
        let mut f = fs::File::create(&path).unwrap();
        writeln!(f, "x").unwrap();
        assert_eq!(find_front_image(&dir).as_deref(), Some(path.as_path()));
        let _ = fs::remove_dir_all(&dir);
    }
}
