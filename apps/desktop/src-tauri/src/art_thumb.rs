use crate::art_cache;
use image::imageops::FilterType;
use image::ImageFormat;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

/// Row art displays at 36px; generate 2x for Retina.
pub const ROW_THUMB_SIZE: u32 = 72;

pub fn art_thumb_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("art").join("thumbs")
}

fn source_modified_ms(path: &Path) -> Result<u64, String> {
    let meta = fs::metadata(path).map_err(|e| format!("Cannot stat art file: {e}"))?;
    let modified = meta
        .modified()
        .map_err(|e| format!("Cannot read art modification time: {e}"))?;
    modified
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .map_err(|e| format!("Invalid art modification time: {e}"))
}

fn row_thumb_path(app_data_dir: &Path, art_path: &str, size: u32, source_mtime_ms: u64) -> PathBuf {
    let key = art_cache::art_cache_key(art_path);
    art_thumb_dir(app_data_dir).join(format!("{key}-{size}-{source_mtime_ms}.jpg"))
}

fn prune_stale_row_thumbs(
    app_data_dir: &Path,
    art_path: &str,
    size: u32,
    keep: &Path,
) -> Result<(), String> {
    let dir = art_thumb_dir(app_data_dir);
    if !dir.is_dir() {
        return Ok(());
    }

    let prefix = format!("{}-{size}-", art_cache::art_cache_key(art_path));
    let entries = fs::read_dir(&dir).map_err(|e| e.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path == keep {
            continue;
        }
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with(&prefix) && name.ends_with(".jpg") {
            let _ = fs::remove_file(path);
        }
    }
    Ok(())
}

fn generate_row_thumb(source: &Path, dest: &Path, size: u32) -> Result<(), String> {
    let img = image::open(source).map_err(|e| format!("Failed to read album art: {e}"))?;
    let thumb = img.resize_to_fill(size, size, FilterType::Triangle);
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    thumb
        .save_with_format(dest, ImageFormat::Jpeg)
        .map_err(|e| format!("Failed to write row art thumbnail: {e}"))
}

/// Return a cached JPEG thumbnail path for list-row art, generating if needed.
pub fn ensure_row_thumb(
    app_data_dir: &Path,
    art_path: &str,
    size: u32,
) -> Result<Option<PathBuf>, String> {
    if art_path.trim().is_empty() {
        return Ok(None);
    }

    let source = Path::new(art_path);
    if !source.is_file() {
        return Ok(None);
    }

    let source_mtime_ms = source_modified_ms(source)?;
    let dest = row_thumb_path(app_data_dir, art_path, size, source_mtime_ms);
    if dest.is_file() {
        return Ok(Some(dest));
    }

    prune_stale_row_thumbs(app_data_dir, art_path, size, &dest)?;
    generate_row_thumb(source, &dest, size)?;
    Ok(Some(dest))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn write_test_image(path: &Path, width: u32, height: u32) {
        let img = image::RgbaImage::from_fn(width, height, |x, y| {
            image::Rgba([(x * 40) as u8, (y * 40) as u8, 128, 255])
        });
        img.save_with_format(path, ImageFormat::Png).unwrap();
    }

    #[test]
    fn ensure_row_thumb_generates_and_reuses_cached_file() {
        let app_data =
            std::env::temp_dir().join(format!("spiral-art-thumb-{}", std::process::id()));
        let _ = fs::remove_dir_all(&app_data);

        let source = app_data.join("cover.png");
        fs::create_dir_all(&app_data).unwrap();
        write_test_image(&source, 600, 600);

        let source_str = source.to_string_lossy().into_owned();
        let first = ensure_row_thumb(&app_data, &source_str, ROW_THUMB_SIZE)
            .unwrap()
            .expect("thumb path");
        assert!(first.is_file());

        let decoded = image::open(&first).unwrap();
        assert_eq!(decoded.width(), ROW_THUMB_SIZE);
        assert_eq!(decoded.height(), ROW_THUMB_SIZE);

        let second = ensure_row_thumb(&app_data, &source_str, ROW_THUMB_SIZE)
            .unwrap()
            .expect("cached thumb path");
        assert_eq!(first, second);

        let _ = fs::remove_dir_all(&app_data);
    }

    #[test]
    fn ensure_row_thumb_returns_none_for_missing_source() {
        let app_data =
            std::env::temp_dir().join(format!("spiral-art-thumb-missing-{}", std::process::id()));
        let _ = fs::remove_dir_all(&app_data);
        fs::create_dir_all(&app_data).unwrap();

        assert!(
            ensure_row_thumb(&app_data, "/no/such/cover.jpg", ROW_THUMB_SIZE)
                .unwrap()
                .is_none()
        );

        let _ = fs::remove_dir_all(&app_data);
    }

    #[test]
    fn ensure_row_thumb_regenerates_when_source_mtime_changes() {
        let app_data =
            std::env::temp_dir().join(format!("spiral-art-thumb-mtime-{}", std::process::id()));
        let _ = fs::remove_dir_all(&app_data);
        fs::create_dir_all(&app_data).unwrap();

        let source = app_data.join("cover.png");
        write_test_image(&source, 400, 400);
        let source_str = source.to_string_lossy().into_owned();

        let first = ensure_row_thumb(&app_data, &source_str, ROW_THUMB_SIZE)
            .unwrap()
            .expect("first thumb");

        std::thread::sleep(std::time::Duration::from_millis(20));
        let mut file = fs::OpenOptions::new().append(true).open(&source).unwrap();
        writeln!(file, " ").unwrap();

        let second = ensure_row_thumb(&app_data, &source_str, ROW_THUMB_SIZE)
            .unwrap()
            .expect("second thumb");
        assert_ne!(first, second);
        assert!(second.is_file());
        assert!(!first.exists());

        let _ = fs::remove_dir_all(&app_data);
    }

    #[test]
    fn ensure_row_thumb_honors_grid_size() {
        // Keep in sync with TS `GRID_ART_THUMB_SIZE` (2× browse min column).
        const GRID_SIZE: u32 = 320;
        let app_data =
            std::env::temp_dir().join(format!("spiral-art-thumb-grid-{}", std::process::id()));
        let _ = fs::remove_dir_all(&app_data);

        let source = app_data.join("cover.png");
        fs::create_dir_all(&app_data).unwrap();
        write_test_image(&source, 800, 800);

        let source_str = source.to_string_lossy().into_owned();
        let thumb = ensure_row_thumb(&app_data, &source_str, GRID_SIZE)
            .unwrap()
            .expect("grid thumb path");
        let decoded = image::open(&thumb).unwrap();
        assert_eq!(decoded.width(), GRID_SIZE);
        assert_eq!(decoded.height(), GRID_SIZE);

        let row = ensure_row_thumb(&app_data, &source_str, ROW_THUMB_SIZE)
            .unwrap()
            .expect("row thumb path");
        assert_ne!(thumb, row);
        let row_decoded = image::open(&row).unwrap();
        assert_eq!(row_decoded.width(), ROW_THUMB_SIZE);

        let _ = fs::remove_dir_all(&app_data);
    }
}
