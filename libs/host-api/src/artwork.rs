//! Artwork sizes: snapping a requested size, resizing, and the resize cache.
//!
//! Everything here touches the disk or decodes images, so it runs on a
//! blocking thread.

use crate::library::ArtworkOriginal;
use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use image::{ImageFormat, ImageReader};
use std::fs;
use std::io::{self, BufWriter};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

/// The sizes a client can get, as the longer side in pixels. A requested
/// `max` snaps up to the next one, so the cache holds a few files per image
/// instead of one per size a client ever asked for.
pub(crate) const SIZES: [u32; 4] = [120, 300, 600, 1200];

const JPEG_QUALITY: u8 = 85;

/// Why a `max` query value was refused.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct BadMax;

/// The size for `?max=`: the smallest of [`SIZES`] at least `max`, or the
/// largest when `max` is bigger. `max` must be a positive decimal integer.
pub(crate) fn snap_max(max: &str) -> Result<u32, BadMax> {
    if max.is_empty() || !max.bytes().all(|b| b.is_ascii_digit()) {
        return Err(BadMax);
    }
    // All digits, so a parse error can only be overflow: bigger than any size.
    let max = max.parse::<u64>().unwrap_or(u64::MAX);
    if max == 0 {
        return Err(BadMax);
    }
    Ok(SIZES
        .into_iter()
        .find(|&size| u64::from(size) >= max)
        .unwrap_or(SIZES[SIZES.len() - 1]))
}

/// The image's longer side: as the library recorded it, else read from the
/// file's header. `None` when neither knows.
pub(crate) fn longer_side(original: &ArtworkOriginal) -> Option<u32> {
    match (original.width, original.height) {
        (Some(w), Some(h)) => Some(w.max(h)),
        _ => ImageReader::open(&original.path)
            .ok()?
            .with_guessed_format()
            .ok()?
            .into_dimensions()
            .ok()
            .map(|(w, h)| w.max(h)),
    }
}

/// A resized copy in the cache.
pub(crate) struct Resized {
    pub path: PathBuf,
    pub mime: &'static str,
}

/// `hash` at `size` (longer side) from the cache, made from `source` first
/// when it isn't there. JPEG, or PNG when the source has an alpha channel.
pub(crate) fn resized(
    cache_dir: &Path,
    hash: &str,
    source: &Path,
    size: u32,
) -> Result<Resized, Box<dyn std::error::Error + Send + Sync>> {
    let name = |ext: &str| cache_dir.join(format!("{hash}-{size}.{ext}"));
    for (ext, mime) in [("jpg", "image/jpeg"), ("png", "image/png")] {
        let path = name(ext);
        if path.is_file() {
            return Ok(Resized { path, mime });
        }
    }

    let image = ImageReader::open(source)?.with_guessed_format()?.decode()?;
    let image = image.resize(size, size, FilterType::Lanczos3);
    let (ext, mime) = if image.color().has_alpha() {
        ("png", "image/png")
    } else {
        ("jpg", "image/jpeg")
    };
    let path = name(ext);
    write_atomically(cache_dir, &path, |out| {
        if ext == "png" {
            image.write_to(out, ImageFormat::Png)
        } else {
            image
                .to_rgb8()
                .write_with_encoder(JpegEncoder::new_with_quality(out, JPEG_QUALITY))
        }
        .map_err(io::Error::other)
    })?;
    Ok(Resized { path, mime })
}

/// Writes `path` (in `dir`) through a temp file in the same folder and a
/// rename, so a concurrent reader sees the whole file or none of it.
fn write_atomically(
    dir: &Path,
    path: &Path,
    write: impl FnOnce(&mut BufWriter<fs::File>) -> io::Result<()>,
) -> io::Result<()> {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    fs::create_dir_all(dir)?;
    let file_name = path.file_name().unwrap_or_default().to_string_lossy();
    let temp = dir.join(format!(
        ".{file_name}.{}-{}.tmp",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    let result = (|| {
        let mut out = BufWriter::new(fs::File::create(&temp)?);
        write(&mut out)?;
        out.into_inner().map_err(|e| e.into_error())?.sync_all()?;
        fs::rename(&temp, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn max_snaps_up_to_a_known_size() {
        for (max, size) in [
            ("1", 120),
            ("120", 120),
            ("121", 300),
            ("200", 300),
            ("300", 300),
            ("301", 600),
            ("600", 600),
            ("601", 1200),
            ("1200", 1200),
            ("1201", 1200),
            ("99999999999999999999999", 1200),
            ("0120", 120),
        ] {
            assert_eq!(snap_max(max), Ok(size), "{max}");
        }
    }

    #[test]
    fn max_must_be_a_positive_integer() {
        for max in ["", "0", "000", "-1", "+5", "1.5", "abc", " 5", "5 "] {
            assert_eq!(snap_max(max), Err(BadMax), "{max:?}");
        }
    }
}
