//! Custom wrap pipeline: decode → fit ID-1 canvas → hybrid re-encode (EXIF stripped).
//!
//! Contract: `docs/license/spcard-v1.md` §Wrap. Never trust redistributed `wrapData`.
//! - Opaque → JPEG (small for photos)
//! - Meaningful alpha → PNG (keeps transparency)
//! - Load path validates cheaply; full re-encode only on Studio write / set.

use super::{err, LicenseError};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use image::codecs::jpeg::JpegEncoder;
use image::codecs::png::{CompressionType, FilterType as PngFilterType, PngEncoder};
use image::imageops::FilterType;
use image::{DynamicImage, ImageEncoder, RgbaImage};
use std::io::Cursor;

/// Design / sanitize canvas — ISO/IEC 7810 ID-1 (856×540).
pub(crate) const WRAP_MAX_WIDTH: u32 = 856;
pub(crate) const WRAP_MAX_HEIGHT: u32 = 540;

/// Hard max for re-encoded wrap payload (~2.7 MB Base64 in `.spcard`).
pub(crate) const WRAP_MAX_BYTES: usize = 2 * 1024 * 1024;

/// JPEG quality attempts (highest first) for opaque wraps.
const WRAP_JPEG_QUALITIES: &[u8] = &[85, 75, 65, 55];

/// Decode raw image bytes, fit within wrap canvas, re-encode JPEG or PNG.
/// Used on Studio set / write — not on every card load.
pub(crate) fn sanitize_wrap_image_bytes(raw: &[u8]) -> Result<Vec<u8>, LicenseError> {
    let img = image::load_from_memory(raw).map_err(|e| {
        err(
            "invalid_wrap",
            format!("could not decode wrap image: {e}"),
        )
    })?;
    encode_capped_wrap(img)
}

/// Decode Base64 `wrapData`, sanitize, return fresh Base64 JPEG or PNG.
pub(crate) fn sanitize_wrap_base64(data: &str) -> Result<String, LicenseError> {
    let raw = BASE64.decode(data.trim()).map_err(|_| {
        err("invalid_wrap", "wrapData is not valid Base64")
    })?;
    let encoded = sanitize_wrap_image_bytes(&raw)?;
    Ok(BASE64.encode(encoded))
}

/// Soft path for **load/repair**: validate decode + size/dims; pass through when
/// already within caps so opening the modal stays snappy. Re-encodes only when
/// the stored wrap exceeds the canvas or byte budget.
pub(crate) fn try_accept_wrap_base64_for_load(data: &str) -> Option<String> {
    accept_wrap_base64_for_load(data).ok()
}

fn accept_wrap_base64_for_load(data: &str) -> Result<String, LicenseError> {
    let raw = BASE64.decode(data.trim()).map_err(|_| {
        err("invalid_wrap", "wrapData is not valid Base64")
    })?;
    if raw.is_empty() || raw.len() > WRAP_MAX_BYTES {
        return Err(too_large(raw.len().max(1)));
    }

    let img = image::load_from_memory(&raw).map_err(|e| {
        err(
            "invalid_wrap",
            format!("could not decode wrap image: {e}"),
        )
    })?;
    let (w, h) = (img.width(), img.height());
    if w == 0 || h == 0 {
        return Err(err("invalid_wrap", "wrap image has zero dimensions"));
    }

    // Already sanitized on write — skip expensive PNG Best / JPEG re-encode.
    if w <= WRAP_MAX_WIDTH && h <= WRAP_MAX_HEIGHT {
        return Ok(BASE64.encode(raw));
    }

    // Oversized canvas from an older card / hand-edited file — resize + encode.
    let encoded = encode_capped_wrap(img)?;
    Ok(BASE64.encode(encoded))
}

fn encode_capped_wrap(img: DynamicImage) -> Result<Vec<u8>, LicenseError> {
    let (w, h) = (img.width(), img.height());
    if w == 0 || h == 0 {
        return Err(err("invalid_wrap", "wrap image has zero dimensions"));
    }

    // Contain within 856×540 — preserve aspect; display cover-crops to ID-1.
    let resized = if w > WRAP_MAX_WIDTH || h > WRAP_MAX_HEIGHT {
        img.resize(WRAP_MAX_WIDTH, WRAP_MAX_HEIGHT, FilterType::Triangle)
    } else {
        img
    };

    let rgba = resized.to_rgba8();
    if has_meaningful_alpha(&rgba) {
        encode_capped_png(&rgba)
    } else {
        encode_capped_jpeg(&rgba)
    }
}

/// True if any pixel is not fully opaque (keeps soft edges / cutouts).
fn has_meaningful_alpha(img: &RgbaImage) -> bool {
    img.pixels().any(|p| p[3] < 255)
}

fn encode_capped_jpeg(rgba: &RgbaImage) -> Result<Vec<u8>, LicenseError> {
    // Drop alpha channel without cloning the full RGBA buffer first.
    let rgb = image::RgbImage::from_fn(rgba.width(), rgba.height(), |x, y| {
        let p = rgba.get_pixel(x, y);
        image::Rgb([p[0], p[1], p[2]])
    });
    let (rw, rh) = (rgb.width(), rgb.height());

    let mut last_len = 0usize;
    for &quality in WRAP_JPEG_QUALITIES {
        let mut out = Cursor::new(Vec::new());
        let mut encoder = JpegEncoder::new_with_quality(&mut out, quality);
        encoder
            .encode(rgb.as_raw(), rw, rh, image::ExtendedColorType::Rgb8)
            .map_err(|e| err("invalid_wrap", format!("failed to encode wrap JPEG: {e}")))?;
        let jpeg = out.into_inner();
        last_len = jpeg.len();
        if jpeg.len() <= WRAP_MAX_BYTES {
            return Ok(jpeg);
        }
    }

    Err(too_large(last_len))
}

fn encode_capped_png(rgba: &RgbaImage) -> Result<Vec<u8>, LicenseError> {
    let mut out = Cursor::new(Vec::new());
    let encoder = PngEncoder::new_with_quality(
        &mut out,
        CompressionType::Best,
        PngFilterType::Adaptive,
    );
    encoder
        .write_image(
            rgba.as_raw(),
            rgba.width(),
            rgba.height(),
            image::ExtendedColorType::Rgba8,
        )
        .map_err(|e| err("invalid_wrap", format!("failed to encode wrap PNG: {e}")))?;
    let png = out.into_inner();
    if png.len() > WRAP_MAX_BYTES {
        return Err(too_large(png.len()));
    }
    Ok(png)
}

fn too_large(got: usize) -> LicenseError {
    err(
        "invalid_wrap",
        format!(
            "re-encoded wrap image is too large (max {} KiB, got {} KiB)",
            WRAP_MAX_BYTES / 1024,
            (got + 1023) / 1024
        ),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::Rgba;

    fn solid_png(width: u32, height: u32, alpha: u8) -> Vec<u8> {
        let img = RgbaImage::from_pixel(width, height, Rgba([10, 20, 30, alpha]));
        let mut out = Cursor::new(Vec::new());
        DynamicImage::ImageRgba8(img)
            .write_to(&mut out, image::ImageFormat::Png)
            .unwrap();
        out.into_inner()
    }

    #[test]
    fn sanitizes_and_caps_oversized_opaque_as_jpeg() {
        let raw = solid_png(3000, 2000, 255);
        let out = sanitize_wrap_image_bytes(&raw).unwrap();
        let img = image::load_from_memory(&out).unwrap();
        assert!(img.width() <= WRAP_MAX_WIDTH);
        assert!(img.height() <= WRAP_MAX_HEIGHT);
        assert!(out.len() <= WRAP_MAX_BYTES);
        assert_eq!(&out[0..2], &[0xff, 0xd8]);
    }

    #[test]
    fn transparent_wrap_stored_as_png() {
        let raw = solid_png(400, 250, 128);
        let out = sanitize_wrap_image_bytes(&raw).unwrap();
        assert!(out.len() <= WRAP_MAX_BYTES);
        assert_eq!(&out[0..8], b"\x89PNG\r\n\x1a\n");
        let img = image::load_from_memory(&out).unwrap().to_rgba8();
        assert!(img.pixels().any(|p| p[3] < 255));
    }

    #[test]
    fn photo_like_opaque_stays_under_cap_as_jpeg() {
        let mut img = RgbaImage::new(1200, 800);
        for (x, y, px) in img.enumerate_pixels_mut() {
            let g = ((x * 255) / 1200) as u8;
            let b = ((y * 255) / 800) as u8;
            let grain = ((x.wrapping_mul(13) ^ y.wrapping_mul(7)) % 24) as u8;
            *px = Rgba([
                g.saturating_add(grain / 2),
                80u8.saturating_add(grain),
                b.saturating_add(grain / 3),
                255,
            ]);
        }
        let mut raw = Cursor::new(Vec::new());
        DynamicImage::ImageRgba8(img)
            .write_to(&mut raw, image::ImageFormat::Jpeg)
            .unwrap();
        let out = sanitize_wrap_image_bytes(&raw.into_inner()).unwrap();
        assert!(out.len() <= WRAP_MAX_BYTES);
        assert_eq!(&out[0..2], &[0xff, 0xd8]);
    }

    #[test]
    fn load_path_passes_through_valid_wrap_without_reencode() {
        let raw = sanitize_wrap_image_bytes(&solid_png(400, 250, 128)).unwrap();
        let b64 = BASE64.encode(&raw);
        let accepted = accept_wrap_base64_for_load(&b64).unwrap();
        // Same payload — no re-compress.
        assert_eq!(accepted, b64);
    }

    #[test]
    fn load_path_resizes_oversized_canvas() {
        let raw = solid_png(2000, 1200, 255);
        let b64 = BASE64.encode(&raw);
        let accepted = accept_wrap_base64_for_load(&b64).unwrap();
        let out = BASE64.decode(&accepted).unwrap();
        let img = image::load_from_memory(&out).unwrap();
        assert!(img.width() <= WRAP_MAX_WIDTH);
        assert!(img.height() <= WRAP_MAX_HEIGHT);
    }

    #[test]
    fn rejects_non_image() {
        let err = sanitize_wrap_image_bytes(b"not-an-image").unwrap_err();
        assert_eq!(err.code, "invalid_wrap");
    }

    #[test]
    fn base64_round_trip_and_soft_fail() {
        let raw = solid_png(100, 60, 255);
        let b64 = BASE64.encode(&raw);
        let out = sanitize_wrap_base64(&b64).unwrap();
        assert!(!out.is_empty());
        let decoded = BASE64.decode(&out).unwrap();
        assert_eq!(&decoded[0..2], &[0xff, 0xd8]);
        assert!(try_accept_wrap_base64_for_load("!!!").is_none());
    }
}
