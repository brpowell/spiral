//! Artwork sizes: snapping a requested size, resizing, and the resize cache.
//!
//! Everything here touches the disk or decodes images, so it runs on a
//! blocking thread.
//!
//! The cache folder belongs to the host. Files in it are named by content
//! hash, so they never go stale, and the host can delete any of them (or the
//! whole folder) at any time; nothing here evicts them.

use crate::library::ArtworkOriginal;
use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use image::{DynamicImage, ImageDecoder, ImageFormat, ImageReader, Limits};
use std::fs;
use std::io::{self, Cursor};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime};

/// The sizes a client can get, as the longer side in pixels. A requested
/// `max` snaps up to the next one, so the cache holds a few files per image
/// instead of one per size a client ever asked for.
pub(crate) const SIZES: [u32; 4] = [120, 300, 600, 1200];

const JPEG_QUALITY: u8 = 85;

/// The most a single decode may allocate. Covers are rarely past 4000 px a
/// side (64 MB as RGBA); this leaves room while keeping a hostile or broken
/// file from taking the host's memory.
const MAX_DECODE_BYTES: u64 = 256 * 1024 * 1024;

/// A temp file older than this was left by a write that never finished.
const STALE_TEMP: Duration = Duration::from_secs(60 * 60);

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
/// file's header. `None` when neither knows. An EXIF rotation swaps width
/// and height but not which is longer, so the stored size is enough.
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

/// A resized image: a file in the cache, or the encoded bytes when the cache
/// couldn't be written.
pub(crate) struct Resized {
    pub body: ResizedBody,
    pub mime: &'static str,
}

pub(crate) enum ResizedBody {
    File(PathBuf),
    Bytes(Vec<u8>),
}

/// `hash` at `size` (longer side) from the cache, made from `source` first
/// when it isn't there: upright per its EXIF orientation, JPEG, or PNG when
/// it has transparent pixels. A cache write that fails is logged, and the
/// image is returned in memory instead.
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
            return Ok(Resized {
                body: ResizedBody::File(path),
                mime,
            });
        }
    }

    let image = decode_upright(source)?.resize(size, size, FilterType::Lanczos3);
    let mut bytes = Cursor::new(Vec::new());
    let (ext, mime) = if has_transparency(&image) {
        image.write_to(&mut bytes, ImageFormat::Png)?;
        ("png", "image/png")
    } else {
        image
            .to_rgb8()
            .write_with_encoder(JpegEncoder::new_with_quality(&mut bytes, JPEG_QUALITY))?;
        ("jpg", "image/jpeg")
    };
    let bytes = bytes.into_inner();
    let path = name(ext);
    let body = match write_atomically(cache_dir, &path, &bytes) {
        Ok(()) => ResizedBody::File(path),
        Err(e) => {
            tracing::warn!(error = %e, path = %path.display(), "can't cache resized artwork");
            ResizedBody::Bytes(bytes)
        }
    };
    Ok(Resized { body, mime })
}

/// Decodes `source` within [`MAX_DECODE_BYTES`] and turns it upright: a
/// re-encoded image carries no EXIF, so its orientation has to be applied.
fn decode_upright(source: &Path) -> image::ImageResult<DynamicImage> {
    let mut reader = ImageReader::open(source)?.with_guessed_format()?;
    let mut limits = Limits::default();
    limits.max_alloc = Some(MAX_DECODE_BYTES);
    reader.limits(limits);
    let mut decoder = reader.into_decoder()?;
    let orientation = decoder.orientation()?;
    let mut image = DynamicImage::from_decoder(decoder)?;
    image.apply_orientation(orientation);
    Ok(image)
}

/// Whether any pixel is less than opaque. Many covers are RGBA with every
/// pixel opaque, and those are smaller as JPEG.
fn has_transparency(image: &DynamicImage) -> bool {
    image.color().has_alpha() && image.to_rgba8().pixels().any(|p| p[3] < u8::MAX)
}

/// Writes `bytes` to `path` (in `dir`) through a temp file in the same folder
/// and a rename, so a concurrent reader sees the whole file or none of it.
fn write_atomically(dir: &Path, path: &Path, bytes: &[u8]) -> io::Result<()> {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    fs::create_dir_all(dir)?;
    let file_name = path.file_name().unwrap_or_default().to_string_lossy();
    let temp = dir.join(format!(
        ".{file_name}.{}-{}.tmp",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    let result = (|| {
        let file = fs::File::create(&temp)?;
        io::Write::write_all(&mut &file, bytes)?;
        file.sync_all()?;
        drop(file);
        match fs::rename(&temp, path) {
            // Another request made the same file first. On Windows the rename
            // fails while that one is open; its contents are the same.
            Err(_) if path.is_file() => Ok(()),
            other => other,
        }
    })();
    let _ = fs::remove_file(&temp);
    result
}

/// Removes temp files that a write in `dir` left behind (a host stopped
/// between writing and renaming). Recent ones are kept: they may belong to a
/// write in progress.
pub(crate) fn sweep_stale_temp_files(dir: &Path) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let now = SystemTime::now();
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if !(name.starts_with('.') && name.ends_with(".tmp")) {
            continue;
        }
        let stale = entry
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|modified| now.duration_since(modified).ok())
            .is_some_and(|age| age > STALE_TEMP);
        if stale {
            let _ = fs::remove_file(entry.path());
        }
    }
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
