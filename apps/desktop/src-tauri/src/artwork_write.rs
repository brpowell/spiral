//! Art the editors set: written under `Artwork/` when picked, then recorded in
//! the artwork registry when the edit is saved (`set_*`).

use crate::artwork_extract::{place_album_front, place_front, FrontTarget};
use crate::artwork_paths::{
    album_artwork_dir, artist_artwork_dir, ensure_inside_album_artwork,
    ensure_inside_artist_artwork, ext_from_mime_or_bytes, override_art_filename,
    playlist_artwork_path_stem, to_library_relative, FRONT_STEM, PORTRAIT_STEM,
};
use crate::artwork_registry::{self, files_in, sha256_hex, ArtworkKind};
use crate::ids::PlaylistId;
use crate::metadata_reader;
use rusqlite::Connection;
use std::fs;
use std::path::{Path, PathBuf};

/// Write art bytes for a cache key used by editors (`artist:…`, `playlist:…`,
/// `cd://…`, or a track file path). With `conn`, a track override whose image
/// the album folder already holds returns that file instead of a new one.
///
/// Returns an **absolute** path suitable for UI display / embed-on-save. The
/// art an entity shows changes only when the edit is saved.
pub fn write_art_for_cache_key(
    conn: Option<&Connection>,
    library_root: &Path,
    app_data_dir: &Path,
    cache_key: &str,
    bytes: &[u8],
    mime_or_ext: &str,
) -> Result<String, String> {
    // Library art is square; only the raw copy the cropper edits is exempt.
    let squared;
    let (bytes, mime_or_ext) = match squared_unless_staged_original(cache_key, bytes) {
        Some((out, ext)) => {
            squared = out;
            (squared.as_slice(), ext)
        }
        None => (bytes, mime_or_ext),
    };
    if let Some(artist_key) = cache_key.strip_prefix("artist:") {
        return write_artist_portrait(library_root, artist_key, bytes, mime_or_ext);
    }
    if let Some(rest) = cache_key.strip_prefix("playlist:") {
        // `playlist:{id}` or `playlist:{id}:{title}`
        let (id_str, title) = match rest.split_once(':') {
            Some((id, title)) => (id, title),
            None => (rest, "playlist"),
        };
        let id = PlaylistId::parse(id_str)
            .ok_or_else(|| format!("invalid playlist art key: {cache_key}"))?;
        return write_playlist_art(library_root, &id, title, bytes, mime_or_ext);
    }
    if let Some(track_path) = cache_key.strip_prefix("track-override:") {
        let tags = metadata_reader::read_basic_tags(Path::new(track_path));
        let title = tags
            .title
            .clone()
            .unwrap_or_else(|| metadata_reader::filename_title(Path::new(track_path)));
        return write_track_override_art(
            conn,
            library_root,
            tags.album_artist.as_deref(),
            tags.artist.as_deref(),
            tags.album.as_deref(),
            &title,
            tags.track_number,
            bytes,
            mime_or_ext,
        );
    }
    if cache_key.starts_with("cd://") || !Path::new(cache_key).is_absolute() {
        // CD / synthetic labels stay in app-data art cache.
        let ext = if mime_or_ext.contains('/') {
            crate::art_cache::ext_from_mime(mime_or_ext)
        } else {
            mime_or_ext.trim_start_matches('.')
        };
        crate::art_cache::remove_cached_art(app_data_dir, cache_key)?;
        let dest = crate::art_cache::write_bytes_to_art_cache(app_data_dir, cache_key, bytes, ext)?;
        return Ok(dest.to_string_lossy().into_owned());
    }

    // Absolute track file path → album front (album editor / shared assign).
    write_album_front_for_track(library_root, cache_key, bytes, mime_or_ext)
}

/// Editors stage the fetched original under a `staging:…-download` key so the
/// cropper can work from the untouched image; every other write is squared.
fn squared_unless_staged_original(
    cache_key: &str,
    bytes: &[u8],
) -> Option<(Vec<u8>, &'static str)> {
    if cache_key.starts_with("staging:") && cache_key.ends_with("-download") {
        return None;
    }
    crate::image_crop::squared_for_library(bytes)
}

pub fn write_album_front_for_track(
    library_root: &Path,
    track_file_path: &str,
    bytes: &[u8],
    mime_or_ext: &str,
) -> Result<String, String> {
    let tags = metadata_reader::read_basic_tags(Path::new(track_file_path));
    write_album_front(
        library_root,
        tags.album_artist.as_deref(),
        tags.artist.as_deref(),
        tags.album.as_deref(),
        bytes,
        mime_or_ext,
    )
}

pub fn write_album_front(
    library_root: &Path,
    album_artist: Option<&str>,
    artist: Option<&str>,
    album: Option<&str>,
    bytes: &[u8],
    mime_or_ext: &str,
) -> Result<String, String> {
    let dir = album_artwork_dir(library_root, album_artist, artist, album);
    ensure_inside_album_artwork(library_root, &dir)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let ext = ext_from_key(mime_or_ext, bytes);
    let dest = dir.join(format!("{FRONT_STEM}.{ext}"));
    fs::write(&dest, bytes).map_err(|e| format!("failed to write album front art: {e}"))?;
    Ok(dest.to_string_lossy().into_owned())
}

#[allow(clippy::too_many_arguments)]
pub fn write_track_override_art(
    conn: Option<&Connection>,
    library_root: &Path,
    album_artist: Option<&str>,
    artist: Option<&str>,
    album: Option<&str>,
    title: &str,
    track_number: Option<i32>,
    bytes: &[u8],
    mime_or_ext: &str,
) -> Result<String, String> {
    let dir = album_artwork_dir(library_root, album_artist, artist, album);
    ensure_inside_album_artwork(library_root, &dir)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let ext = ext_from_key(mime_or_ext, bytes);

    if let Some(conn) = conn {
        let hash = sha256_hex(bytes);
        let same = files_in(conn, library_root, &dir)?
            .into_iter()
            .find(|f| f.hash == hash && f.is_intact(library_root))
            .and_then(|f| f.path(library_root));
        if let Some(path) = same {
            return Ok(path.to_string_lossy().into_owned());
        }
    }

    let filename = override_art_filename(track_number, title, FRONT_STEM, ext);
    let dest = dir.join(&filename);
    fs::write(&dest, bytes).map_err(|e| format!("failed to write track override art: {e}"))?;
    Ok(dest.to_string_lossy().into_owned())
}

fn write_artist_portrait(
    library_root: &Path,
    artist_key: &str,
    bytes: &[u8],
    mime_or_ext: &str,
) -> Result<String, String> {
    let dir = artist_artwork_dir(library_root, artist_key);
    ensure_inside_artist_artwork(library_root, &dir)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let ext = ext_from_key(mime_or_ext, bytes);
    let dest = dir.join(format!("{PORTRAIT_STEM}.{ext}"));
    fs::write(&dest, bytes).map_err(|e| e.to_string())?;
    Ok(dest.to_string_lossy().into_owned())
}

fn write_playlist_art(
    library_root: &Path,
    playlist_id: &PlaylistId,
    title: &str,
    bytes: &[u8],
    mime_or_ext: &str,
) -> Result<String, String> {
    let stem = playlist_artwork_path_stem(library_root, playlist_id, title);
    if let Some(parent) = stem.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let ext = ext_from_key(mime_or_ext, bytes);
    let dest = PathBuf::from(format!("{}.{ext}", stem.to_string_lossy()));
    fs::write(&dest, bytes).map_err(|e| e.to_string())?;
    Ok(dest.to_string_lossy().into_owned())
}

/// Bake a crop from `source_path` and write the display playlist cover only.
/// The playlist's other cover files go when the cover is saved
/// ([`set_playlist_cover`]).
pub fn store_cropped_playlist_art(
    library_root: &Path,
    playlist_id: &PlaylistId,
    title: &str,
    source_path: &str,
    crop: crate::image_crop::ImageCrop,
) -> Result<String, String> {
    let source = Path::new(source_path);
    let source_bytes = fs::read(source).map_err(|e| format!("failed to read image source: {e}"))?;

    let (baked, baked_ext) = crate::image_crop::bake_cropped_image(
        &source_bytes,
        crop,
        crate::image_crop::MAX_DISPLAY_EDGE,
    )?;

    let stem = playlist_artwork_path_stem(library_root, playlist_id, title);
    if let Some(parent) = stem.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let display = PathBuf::from(format!("{}.{baked_ext}", stem.to_string_lossy()));
    fs::write(&display, &baked).map_err(|e| format!("failed to write display art: {e}"))?;

    Ok(display.to_string_lossy().into_owned())
}

fn ext_from_key(mime_or_ext: &str, bytes: &[u8]) -> &'static str {
    if mime_or_ext.contains('/') {
        ext_from_mime_or_bytes(mime_or_ext, bytes)
    } else {
        match mime_or_ext
            .trim_start_matches('.')
            .to_ascii_lowercase()
            .as_str()
        {
            "png" => "png",
            "webp" => "webp",
            _ => "jpg",
        }
    }
}

fn read_art(path: &Path) -> Result<Vec<u8>, String> {
    fs::read(path)
        .ok()
        .filter(|b| !b.is_empty())
        .ok_or_else(|| format!("failed to read art {}", path.display()))
}

/// Save a track editor's front art: `art_path` is the image picked (`None`
/// removes the art). An album `front.*` replaces the album's shared front;
/// anything else is placed as [`place_front`] does. Then prunes.
pub fn set_track_front(
    conn: &Connection,
    library_root: &Path,
    target: &FrontTarget<'_>,
    art_path: Option<&Path>,
) -> Result<(), String> {
    match art_path {
        None => {
            artwork_registry::set_track_art(conn, target.track_id, ArtworkKind::Front, None)?;
        }
        Some(path) => {
            let bytes = read_art(path)?;
            let album_front = ensure_inside_album_artwork(library_root, path).is_ok()
                && path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .is_some_and(|s| s.eq_ignore_ascii_case(FRONT_STEM));
            if album_front {
                place_album_front(conn, library_root, target, &bytes)?;
            } else {
                place_front(conn, library_root, target, &bytes)?;
                // The override written for this track when its art was picked,
                // left unused when the image went elsewhere (it became the
                // album's front, or the folder already had it).
                let unused = ensure_inside_album_artwork(library_root, path).is_ok()
                    && to_library_relative(library_root, path)
                        .map(|rel| artwork_registry::file_at(conn, &rel))
                        .transpose()?
                        .flatten()
                        .is_none()
                    && path
                        .file_stem()
                        .and_then(|s| s.to_str())
                        .is_some_and(|s| s.ends_with(&format!(" - {FRONT_STEM}")));
                if unused {
                    let _ = fs::remove_file(path);
                    artwork_registry::prune_empty_dirs(library_root, path);
                }
            }
        }
    }
    artwork_registry::prune(conn, library_root)?;
    Ok(())
}

/// Record `path` as the one copy at `dest`: in place when it is `dest`, else
/// written there. Returns the image's hash.
fn keep_at(
    conn: &Connection,
    library_root: &Path,
    path: &Path,
    dest: &Path,
    bytes: &[u8],
) -> Result<String, String> {
    if path == dest {
        artwork_registry::register(conn, library_root, dest, bytes)
    } else {
        artwork_registry::store(conn, library_root, dest, bytes)
    }
}

/// Remove the recorded files under `Artwork/<…>` whose path starts with
/// `prefix`, except `keep`.
fn remove_files_with_prefix(
    conn: &Connection,
    library_root: &Path,
    dir: &Path,
    prefix: &str,
    keep: &Path,
) -> Result<(), String> {
    let keep_rel = to_library_relative(library_root, keep);
    for file in files_in(conn, library_root, dir)? {
        let name = file.rel_path.rsplit('/').next().unwrap_or_default();
        if name.starts_with(prefix) && Some(&file.rel_path) != keep_rel.as_ref() {
            artwork_registry::remove_file(conn, library_root, &file)?;
        }
    }
    Ok(())
}

/// Save an artist's portrait: `art_path` is the image picked (`None` removes
/// it). Kept as `Artwork/artists/<key>/portrait.<ext>`. Returns the file to
/// show.
pub fn set_artist_portrait(
    conn: &Connection,
    library_root: &Path,
    artist_key: &str,
    art_path: Option<&Path>,
) -> Result<Option<PathBuf>, String> {
    let dir = artist_artwork_dir(library_root, artist_key);
    ensure_inside_artist_artwork(library_root, &dir)?;
    let shown = match art_path {
        None => {
            artwork_registry::set_artist_art(conn, artist_key, ArtworkKind::Portrait, None)?;
            // A copy left here when the image moved to another artist (a
            // rename in the editor) goes; an image nothing shows goes in prune.
            for file in files_in(conn, library_root, &dir)? {
                let elsewhere = artwork_registry::files_for_hash(conn, &file.hash)?
                    .iter()
                    .any(|f| f.rel_path != file.rel_path && f.is_intact(library_root));
                if elsewhere {
                    artwork_registry::remove_file(conn, library_root, &file)?;
                }
            }
            None
        }
        Some(path) => {
            let bytes = read_art(path)?;
            let dest = if path.parent() == Some(dir.as_path()) {
                path.to_path_buf()
            } else {
                dir.join(format!(
                    "{PORTRAIT_STEM}.{}",
                    ext_from_mime_or_bytes("", &bytes)
                ))
            };
            let hash = keep_at(conn, library_root, path, &dest, &bytes)?;
            remove_files_with_prefix(conn, library_root, &dir, "", &dest)?;
            artwork_registry::set_artist_art(conn, artist_key, ArtworkKind::Portrait, Some(&hash))?;
            Some(dest)
        }
    };
    artwork_registry::prune(conn, library_root)?;
    Ok(shown)
}

/// Save a playlist's custom cover: `art_path` is the image picked (`None`
/// removes it). Kept as `Artwork/playlists/<id>-<title>.<ext>`, so a renamed
/// playlist's cover is renamed with it.
pub fn set_playlist_cover(
    conn: &Connection,
    library_root: &Path,
    playlist_id: &PlaylistId,
    title: &str,
    art_path: Option<&Path>,
) -> Result<(), String> {
    match art_path {
        None => {
            artwork_registry::set_playlist_art(conn, playlist_id, ArtworkKind::Cover, None)?;
        }
        Some(path) => {
            let bytes = read_art(path)?;
            let ext = path
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| ext_from_key(e, &bytes))
                .unwrap_or_else(|| ext_from_mime_or_bytes("", &bytes));
            let stem = playlist_artwork_path_stem(library_root, playlist_id, title);
            let dest = PathBuf::from(format!("{}.{ext}", stem.to_string_lossy()));
            let recorded = to_library_relative(library_root, path)
                .map(|rel| artwork_registry::file_at(conn, &rel))
                .transpose()?
                .flatten()
                .filter(|f| f.hash == sha256_hex(&bytes) && f.is_intact(library_root));
            let hash = match recorded {
                // The cover it has, under its old name: move it.
                Some(file) if path != dest => {
                    artwork_registry::move_file(conn, library_root, &file, &dest)?;
                    file.hash
                }
                _ => keep_at(conn, library_root, path, &dest, &bytes)?,
            };
            let dir = stem.parent().map(Path::to_path_buf).unwrap_or_default();
            remove_files_with_prefix(conn, library_root, &dir, &format!("{playlist_id}-"), &dest)?;
            artwork_registry::set_playlist_art(conn, playlist_id, ArtworkKind::Cover, Some(&hash))?;
        }
    }
    artwork_registry::prune(conn, library_root)?;
    Ok(())
}

/// The file to show for a playlist's custom cover, if it has an intact one.
pub fn playlist_cover_path(
    conn: &Connection,
    library_root: &Path,
    playlist_id: &PlaylistId,
) -> Result<Option<PathBuf>, String> {
    let Some(hash) = artwork_registry::playlist_art(conn, playlist_id, ArtworkKind::Cover)? else {
        return Ok(None);
    };
    let dir =
        crate::artwork_paths::artwork_root(library_root).join(crate::artwork_paths::PLAYLISTS_DIR);
    artwork_registry::resolve(conn, library_root, &hash, Some(&dir))
}

/// The file to show for an artist's portrait, if it has an intact one.
pub fn artist_portrait_path(
    conn: &Connection,
    library_root: &Path,
    artist_key: &str,
    hash: &str,
) -> Result<Option<PathBuf>, String> {
    let dir = artist_artwork_dir(library_root, artist_key);
    artwork_registry::resolve(conn, library_root, hash, Some(&dir))
}
#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgb, RgbImage};
    use std::io::Cursor;

    fn temp_root(label: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "spiral-crop-art-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn store_cropped_playlist_art_writes_display_only() {
        let root = temp_root("store");
        let mut img = RgbImage::new(4, 2);
        for y in 0..2 {
            for x in 0..4 {
                img.put_pixel(
                    x,
                    y,
                    if x < 2 {
                        Rgb([255, 0, 0])
                    } else {
                        Rgb([0, 0, 255])
                    },
                );
            }
        }
        let mut png = Vec::new();
        image::DynamicImage::ImageRgb8(img)
            .write_to(&mut Cursor::new(&mut png), image::ImageFormat::Png)
            .unwrap();
        let source_path = root.join("pick.png");
        fs::write(&source_path, &png).unwrap();

        let crop = crate::image_crop::ImageCrop {
            x: 0.5,
            y: 0.0,
            width: 0.5,
            height: 1.0,
        };
        let display = store_cropped_playlist_art(
            &root,
            &PlaylistId::from("7"),
            "Summer",
            source_path.to_str().unwrap(),
            crop,
        )
        .unwrap();

        let display_path = PathBuf::from(&display);
        assert!(display_path.is_file());
        let stem = crate::artwork_paths::playlist_artwork_path_stem(
            &root,
            &PlaylistId::from("7"),
            "Summer",
        );
        let parent = stem.parent().unwrap();
        let entries: Vec<_> = fs::read_dir(parent)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(
            entries.len(),
            1,
            "expected only the display file, got {entries:?}"
        );
        assert!(!entries.iter().any(|n| n.contains(".source.")));
        assert!(!entries.iter().any(|n| n.ends_with(".crop.json")));

        let _ = fs::remove_dir_all(&root);
    }

    fn png_bytes(w: u32, h: u32) -> Vec<u8> {
        let mut out = Vec::new();
        image::DynamicImage::ImageRgb8(RgbImage::from_pixel(w, h, Rgb([9, 9, 9])))
            .write_to(&mut Cursor::new(&mut out), image::ImageFormat::Png)
            .unwrap();
        out
    }

    #[test]
    fn writes_are_squared_except_the_staged_original() {
        let root = temp_root("square");
        let app_data = root.join("app");
        let wide = png_bytes(300, 200);

        let portrait =
            write_art_for_cache_key(None, &root, &app_data, "artist:Someone", &wide, "png")
                .unwrap();
        let (w, h) = image::image_dimensions(&portrait).unwrap();
        assert_eq!((w, h), (200, 200));

        let preview =
            write_art_for_cache_key(None, &root, &app_data, "staging:x-editor", &wide, "png")
                .unwrap();
        assert_eq!(image::image_dimensions(&preview).unwrap(), (200, 200));

        let original = write_art_for_cache_key(
            None,
            &root,
            &app_data,
            "staging:x-editor-download",
            &wide,
            "png",
        )
        .unwrap();
        assert_eq!(image::image_dimensions(&original).unwrap(), (300, 200));

        let _ = fs::remove_dir_all(&root);
    }

    struct Library {
        tmp: crate::source_test_support::TempDir,
        conn: Connection,
    }

    impl Library {
        fn new(label: &str) -> Self {
            let tmp = crate::source_test_support::TempDir::new(label);
            let conn = crate::source_test_support::conn();
            crate::sources::attach_spiral_folder(&conn, &tmp.0).unwrap();
            Self { tmp, conn }
        }

        fn root(&self) -> &Path {
            &self.tmp.0
        }

        fn rev(&self) -> i64 {
            self.conn
                .query_row("SELECT rev FROM library_meta", [], |r| r.get(0))
                .unwrap()
        }

        fn rel_files(&self) -> Vec<String> {
            let mut files: Vec<String> = artwork_registry::all_files(&self.conn)
                .unwrap()
                .into_values()
                .flatten()
                .map(|f| f.rel_path)
                .collect();
            files.sort();
            files
        }
    }

    #[test]
    fn a_saved_portrait_is_recorded_and_removing_it_deletes_it() {
        let lib = Library::new("portrait");
        let picked = write_artist_portrait(lib.root(), "Someone", &png_bytes(4, 4), "png").unwrap();
        let shown = set_artist_portrait(&lib.conn, lib.root(), "Someone", Some(Path::new(&picked)))
            .unwrap();
        assert_eq!(shown.as_deref(), Some(Path::new(&picked)));
        assert_eq!(
            lib.rel_files(),
            vec!["Artwork/artists/Someone/portrait.png"]
        );
        assert_eq!(lib.rev(), 1);

        set_artist_portrait(&lib.conn, lib.root(), "Someone", None).unwrap();
        assert_eq!(lib.rev(), 2);
        assert!(lib.rel_files().is_empty());
        assert!(!Path::new(&picked).exists());
    }

    #[test]
    fn a_playlist_cover_follows_a_rename_and_goes_with_the_playlist() {
        let lib = Library::new("cover");
        let id = crate::db::create_playlist(
            &lib.conn,
            "Summer",
            None,
            crate::models::PlaylistImageMode::Custom,
            None,
            None,
            None,
        )
        .unwrap();
        let picked =
            write_playlist_art(lib.root(), &id, "Summer", &png_bytes(3, 3), "png").unwrap();
        let before = lib.rev();
        set_playlist_cover(
            &lib.conn,
            lib.root(),
            &id,
            "Summer",
            Some(Path::new(&picked)),
        )
        .unwrap();
        assert_eq!(lib.rev(), before + 1);
        assert_eq!(
            lib.rel_files(),
            vec![format!("Artwork/playlists/{id}-Summer.png")]
        );

        // Saving the same cover under a new title renames its file; the link
        // (the same image) doesn't change.
        let shown = playlist_cover_path(&lib.conn, lib.root(), &id)
            .unwrap()
            .unwrap();
        let before = lib.rev();
        set_playlist_cover(&lib.conn, lib.root(), &id, "Winter", Some(&shown)).unwrap();
        assert_eq!(lib.rev(), before);
        assert_eq!(
            lib.rel_files(),
            vec![format!("Artwork/playlists/{id}-Winter.png")]
        );
        assert!(!shown.exists());

        crate::db::delete_playlist(&lib.conn, &id).unwrap();
        artwork_registry::prune(&lib.conn, lib.root()).unwrap();
        assert!(lib.rel_files().is_empty());
        assert!(!lib
            .root()
            .join(format!("Artwork/playlists/{id}-Winter.png"))
            .exists());
    }

    #[test]
    fn a_track_editors_front_is_linked_and_removable() {
        let lib = Library::new("track-front");
        let source =
            crate::source_test_support::add_managed_source(&lib.conn, &lib.tmp.dir("Tracks"));
        let id = crate::source_test_support::insert_track(&lib.conn, "a.mp3", source);
        let target = FrontTarget {
            track_id: &id,
            album_artist: None,
            artist: Some("Artist"),
            album: Some("Album"),
            title: "Song",
            track_number: Some(1),
        };
        let front = write_album_front(
            lib.root(),
            None,
            Some("Artist"),
            Some("Album"),
            b"F1",
            "jpg",
        )
        .unwrap();
        let before = lib.rev();
        set_track_front(&lib.conn, lib.root(), &target, Some(Path::new(&front))).unwrap();
        assert!(lib.rev() > before);
        assert_eq!(
            lib.rel_files(),
            vec!["Artwork/albums/Artist/Album/front.jpg"]
        );

        // A new album front replaces the old one in place.
        let front = write_album_front(
            lib.root(),
            None,
            Some("Artist"),
            Some("Album"),
            b"F2",
            "jpg",
        )
        .unwrap();
        set_track_front(&lib.conn, lib.root(), &target, Some(Path::new(&front))).unwrap();
        assert_eq!(
            artwork_registry::track_art(&lib.conn, &id, ArtworkKind::Front).unwrap(),
            Some(sha256_hex(b"F2"))
        );
        assert_eq!(
            lib.rel_files(),
            vec!["Artwork/albums/Artist/Album/front.jpg"]
        );

        let before = lib.rev();
        set_track_front(&lib.conn, lib.root(), &target, None).unwrap();
        assert!(lib.rev() > before);
        assert!(lib.rel_files().is_empty());
    }
}
