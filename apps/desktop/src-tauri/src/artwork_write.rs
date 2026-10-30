use crate::artwork_paths::{
    self, album_artwork_dir, artist_artwork_dir, ensure_inside_album_artwork,
    ensure_inside_artist_artwork, ext_from_mime_or_bytes, find_front_image, find_portrait_image,
    override_art_filename, playlist_artwork_path_stem, to_library_relative, FRONT_STEM,
    PORTRAIT_STEM,
};
use crate::metadata_reader;
use std::fs;
use std::path::{Path, PathBuf};

/// Write art bytes for a cache key used by editors (`artist:…`, `playlist:…`,
/// `cd://…`, or a track file path).
///
/// Returns an **absolute** path suitable for UI display / embed-on-save.
pub fn write_art_for_cache_key(
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
        let id: i64 = id_str
            .parse()
            .map_err(|_| format!("invalid playlist art key: {cache_key}"))?;
        return write_playlist_art(library_root, id, title, bytes, mime_or_ext);
    }
    if let Some(track_path) = cache_key.strip_prefix("track-override:") {
        let tags = metadata_reader::read_basic_tags(Path::new(track_path));
        let title = tags
            .title
            .clone()
            .unwrap_or_else(|| metadata_reader::filename_title(Path::new(track_path)));
        return write_track_override_art(
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
    if let Some(existing) = find_front_image(&dir) {
        if existing != dest {
            let _ = fs::remove_file(&existing);
        }
    }
    fs::write(&dest, bytes).map_err(|e| format!("failed to write album front art: {e}"))?;
    Ok(dest.to_string_lossy().into_owned())
}

pub fn write_track_override_art(
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

    if let Some(front) = find_front_image(&dir) {
        if fs::read(&front).ok().as_deref() == Some(bytes) {
            return Ok(front.to_string_lossy().into_owned());
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
    if let Some(existing) = find_portrait_image(&dir) {
        if existing != dest {
            let _ = fs::remove_file(&existing);
        }
    }
    fs::write(&dest, bytes).map_err(|e| e.to_string())?;
    Ok(dest.to_string_lossy().into_owned())
}

fn write_playlist_art(
    library_root: &Path,
    playlist_id: i64,
    title: &str,
    bytes: &[u8],
    mime_or_ext: &str,
) -> Result<String, String> {
    let stem = playlist_artwork_path_stem(library_root, playlist_id, title);
    if let Some(parent) = stem.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let ext = ext_from_key(mime_or_ext, bytes);
    // Remove prior files for this playlist id (keep room for a clean write).
    clear_playlist_art_files(library_root, playlist_id)?;
    let dest = PathBuf::from(format!("{}.{ext}", stem.to_string_lossy()));
    fs::write(&dest, bytes).map_err(|e| e.to_string())?;
    Ok(dest.to_string_lossy().into_owned())
}

/// Bake a crop from `source_path` and write the display playlist cover only.
pub fn store_cropped_playlist_art(
    library_root: &Path,
    playlist_id: i64,
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
    clear_playlist_art_files(library_root, playlist_id)?;

    let display = PathBuf::from(format!("{}.{baked_ext}", stem.to_string_lossy()));
    fs::write(&display, &baked).map_err(|e| format!("failed to write display art: {e}"))?;

    Ok(display.to_string_lossy().into_owned())
}

fn clear_playlist_art_files(library_root: &Path, playlist_id: i64) -> Result<(), String> {
    let dir = artwork_paths::artwork_root(library_root).join(artwork_paths::PLAYLISTS_DIR);
    if !dir.is_dir() {
        return Ok(());
    }
    let prefix = format!("{playlist_id}-");
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with(&prefix) && entry.path().is_file() {
            let _ = fs::remove_file(entry.path());
        }
    }
    Ok(())
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

/// When storing track art after editor save: if absolute path is album front, store NULL.
pub fn track_art_path_for_db(library_root: &Path, absolute_or_rel: Option<&str>) -> Option<String> {
    let path = absolute_or_rel?.trim();
    if path.is_empty() {
        return None;
    }
    let abs = if Path::new(path).is_absolute() {
        PathBuf::from(path)
    } else {
        artwork_paths::resolve_library_relative(library_root, path)?
    };
    let name = abs.file_stem()?.to_str()?;
    if name.eq_ignore_ascii_case(FRONT_STEM) {
        return None;
    }
    to_library_relative(library_root, &abs).or_else(|| Some(path.to_string()))
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
        let display =
            store_cropped_playlist_art(&root, 7, "Summer", source_path.to_str().unwrap(), crop)
                .unwrap();

        let display_path = PathBuf::from(&display);
        assert!(display_path.is_file());
        let stem = artwork_paths::playlist_artwork_path_stem(&root, 7, "Summer");
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
            write_art_for_cache_key(&root, &app_data, "artist:Someone", &wide, "png").unwrap();
        let (w, h) = image::image_dimensions(&portrait).unwrap();
        assert_eq!((w, h), (200, 200));

        let preview =
            write_art_for_cache_key(&root, &app_data, "staging:x-editor", &wide, "png").unwrap();
        assert_eq!(image::image_dimensions(&preview).unwrap(), (200, 200));

        let original =
            write_art_for_cache_key(&root, &app_data, "staging:x-editor-download", &wide, "png")
                .unwrap();
        assert_eq!(image::image_dimensions(&original).unwrap(), (300, 200));

        let _ = fs::remove_dir_all(&root);
    }
}
