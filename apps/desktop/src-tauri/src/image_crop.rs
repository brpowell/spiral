//! Crop + bake helpers for cover art (playlist, album, artist).

use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use image::{DynamicImage, GenericImageView, ImageDecoder, ImageEncoder, ImageFormat, ImageReader};
use serde::{Deserialize, Serialize};
use std::io::Cursor;

pub const MAX_DISPLAY_EDGE: u32 = 2000;
pub const JPEG_QUALITY: u8 = 85;
const MIN_MAX_EDGE: u32 = 64;

/// Longest output edge for a requested size, never above the display cap.
pub fn clamp_max_edge(requested: Option<u32>) -> u32 {
    requested
        .unwrap_or(MAX_DISPLAY_EDGE)
        .clamp(MIN_MAX_EDGE, MAX_DISPLAY_EDGE)
}

/// Normalized crop rectangle in source-image space (after EXIF orientation).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageCrop {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl ImageCrop {
    #[cfg(test)]
    pub fn full_frame() -> Self {
        Self {
            x: 0.0,
            y: 0.0,
            width: 1.0,
            height: 1.0,
        }
    }

    pub fn clamp(self) -> Self {
        let width = self.width.clamp(1e-9, 1.0);
        let height = self.height.clamp(1e-9, 1.0);
        Self {
            x: self.x.clamp(0.0, 1.0 - width),
            y: self.y.clamp(0.0, 1.0 - height),
            width,
            height,
        }
    }
}

/// True when baking would not change a single pixel: the crop covers the whole
/// image and nothing needs scaling down. The pixel rect is worked out the same
/// way as in [`crop_and_resize`].
fn leaves_pixels_unchanged(dims: (u32, u32), crop: ImageCrop, max_edge: u32) -> bool {
    let (nw, nh) = dims;
    let crop = crop.clamp();
    let px = |fraction: f64, size: u32| (fraction * f64::from(size)).round() as u32;
    px(crop.x, nw) == 0
        && px(crop.y, nh) == 0
        && px(crop.width, nw) >= nw
        && px(crop.height, nh) >= nh
        && nw.max(nh) <= max_edge
}

/// True when applying `crop` would only re-encode the source, so the original
/// file can be kept as it is. Reads the header, not the pixels. Images with an
/// EXIF rotation are always baked so the stored file is upright everywhere.
pub fn is_passthrough(source_bytes: &[u8], crop: ImageCrop, max_edge: u32) -> Result<bool, String> {
    let reader = ImageReader::new(Cursor::new(source_bytes))
        .with_guessed_format()
        .map_err(|e| format!("failed to sniff image format: {e}"))?;
    let mut decoder = reader
        .into_decoder()
        .map_err(|e| format!("failed to open image decoder: {e}"))?;
    let upright = matches!(
        decoder.orientation(),
        Ok(image::metadata::Orientation::NoTransforms) | Err(_)
    );
    Ok(upright && leaves_pixels_unchanged(decoder.dimensions(), crop, max_edge))
}

/// Decode bytes and apply EXIF orientation. Also reports whether the file
/// needed no rotation or flip.
fn decode_oriented_flag(source_bytes: &[u8]) -> Result<(DynamicImage, bool), String> {
    let reader = ImageReader::new(Cursor::new(source_bytes))
        .with_guessed_format()
        .map_err(|e| format!("failed to sniff image format: {e}"))?;

    let mut decoder = reader
        .into_decoder()
        .map_err(|e| format!("failed to open image decoder: {e}"))?;
    let orientation = decoder
        .orientation()
        .unwrap_or(image::metadata::Orientation::NoTransforms);
    let mut img =
        DynamicImage::from_decoder(decoder).map_err(|e| format!("failed to decode image: {e}"))?;
    img.apply_orientation(orientation);
    Ok((
        img,
        orientation == image::metadata::Orientation::NoTransforms,
    ))
}

fn decode_oriented(source_bytes: &[u8]) -> Result<DynamicImage, String> {
    decode_oriented_flag(source_bytes).map(|(img, _)| img)
}

/// Crop `img` to `crop`, then scale it down so its long edge is at most `max_edge`.
fn crop_and_resize(
    img: &DynamicImage,
    crop: ImageCrop,
    max_edge: u32,
) -> Result<DynamicImage, String> {
    let (nw, nh) = img.dimensions();
    if nw == 0 || nh == 0 {
        return Err("image has zero dimensions".into());
    }

    let crop = crop.clamp();
    let x = ((crop.x * f64::from(nw)).round() as u32).min(nw.saturating_sub(1));
    let y = ((crop.y * f64::from(nh)).round() as u32).min(nh.saturating_sub(1));
    let mut w = ((crop.width * f64::from(nw)).round() as u32).max(1);
    let mut h = ((crop.height * f64::from(nh)).round() as u32).max(1);
    if x + w > nw {
        w = nw - x;
    }
    if y + h > nh {
        h = nh - y;
    }

    let cropped = img.crop_imm(x, y, w, h);
    Ok(if max_edge > 0 && (w > max_edge || h > max_edge) {
        cropped.resize(max_edge, max_edge, FilterType::Lanczos3)
    } else {
        cropped
    })
}

/// Encode as PNG when the image has transparency, otherwise as JPEG.
fn encode_art(img: &DynamicImage) -> Result<(Vec<u8>, &'static str), String> {
    if image_has_transparency(img) {
        let mut out = Vec::new();
        img.write_to(&mut Cursor::new(&mut out), ImageFormat::Png)
            .map_err(|e| format!("failed to encode PNG: {e}"))?;
        Ok((out, "png"))
    } else {
        let rgb = img.to_rgb8();
        let mut out = Vec::new();
        let encoder = JpegEncoder::new_with_quality(&mut out, JPEG_QUALITY);
        encoder
            .write_image(
                rgb.as_raw(),
                rgb.width(),
                rgb.height(),
                image::ExtendedColorType::Rgb8,
            )
            .map_err(|e| format!("failed to encode JPEG: {e}"))?;
        Ok((out, "jpg"))
    }
}

/// Decode bytes, apply EXIF orientation, crop, optionally downscale, and encode.
///
/// Returns `(encoded_bytes, extension)` where extension is `"jpg"` or `"png"`.
pub fn bake_cropped_image(
    source_bytes: &[u8],
    crop: ImageCrop,
    max_edge: u32,
) -> Result<(Vec<u8>, &'static str), String> {
    let img = decode_oriented(source_bytes)?;
    encode_art(&crop_and_resize(&img, crop, max_edge)?)
}

/// Library art is always square. Returns the centered square crop of a
/// non-square image (long edge capped), or `None` when the image is already
/// square or can't be decoded, so the caller keeps writing the original bytes.
pub fn squared_for_library(source_bytes: &[u8]) -> Option<(Vec<u8>, &'static str)> {
    let reader = ImageReader::new(Cursor::new(source_bytes))
        .with_guessed_format()
        .ok()?;
    let (w, h) = reader.into_decoder().ok()?.dimensions();
    if w == h {
        return None;
    }
    let img = decode_oriented(source_bytes).ok()?;
    let (nw, nh) = img.dimensions();
    if nw == nh {
        return None;
    }
    let side = nw.min(nh);
    let crop = ImageCrop {
        x: f64::from(nw - side) / 2.0 / f64::from(nw),
        y: f64::from(nh - side) / 2.0 / f64::from(nh),
        width: f64::from(side) / f64::from(nw),
        height: f64::from(side) / f64::from(nh),
    };
    let squared = crop_and_resize(&img, crop, MAX_DISPLAY_EDGE).ok()?;
    encode_art(&squared).ok()
}

/// A source decoded once, so several crops of it can be measured without
/// decoding again.
pub struct DecodedSource {
    img: DynamicImage,
    upright: bool,
    byte_len: u64,
}

pub fn decode_source(source_bytes: &[u8]) -> Result<DecodedSource, String> {
    let (img, upright) = decode_oriented_flag(source_bytes)?;
    Ok(DecodedSource {
        img,
        upright,
        byte_len: source_bytes.len() as u64,
    })
}

/// Encoded byte size of the baked result for each requested longest-edge cap,
/// without writing anything. A result that would keep the original file reports
/// the source's own size.
pub fn measure_decoded_sizes(
    source: &DecodedSource,
    crop: ImageCrop,
    max_edges: &[Option<u32>],
) -> Result<Vec<u64>, String> {
    // Each size is an independent resize and encode, so run them side by side.
    std::thread::scope(|scope| {
        let handles: Vec<_> = max_edges
            .iter()
            .map(|&edge| {
                scope.spawn(move || {
                    let edge = clamp_max_edge(edge);
                    if source.upright
                        && leaves_pixels_unchanged(source.img.dimensions(), crop, edge)
                    {
                        return Ok(source.byte_len);
                    }
                    let resized = crop_and_resize(&source.img, crop, edge)?;
                    encode_art(&resized).map(|(bytes, _)| bytes.len() as u64)
                })
            })
            .collect();
        handles
            .into_iter()
            .map(|handle| {
                handle
                    .join()
                    .unwrap_or_else(|_| Err("size measurement panicked".into()))
            })
            .collect()
    })
}

/// [`measure_decoded_sizes`] for bytes that are not decoded yet.
#[cfg(test)]
pub fn measure_baked_sizes(
    source_bytes: &[u8],
    crop: ImageCrop,
    max_edges: &[Option<u32>],
) -> Result<Vec<u64>, String> {
    measure_decoded_sizes(&decode_source(source_bytes)?, crop, max_edges)
}

fn image_has_transparency(img: &DynamicImage) -> bool {
    match img {
        DynamicImage::ImageRgba8(buf) => buf.pixels().any(|p| p.0[3] < 255),
        DynamicImage::ImageRgba16(buf) => buf.pixels().any(|p| p.0[3] < u16::MAX),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgb, RgbImage, Rgba, RgbaImage};

    fn encode_png_rgb(img: &RgbImage) -> Vec<u8> {
        let mut bytes = Vec::new();
        DynamicImage::ImageRgb8(img.clone())
            .write_to(&mut Cursor::new(&mut bytes), ImageFormat::Png)
            .unwrap();
        bytes
    }

    fn encode_png_rgba(img: &RgbaImage) -> Vec<u8> {
        let mut bytes = Vec::new();
        DynamicImage::ImageRgba8(img.clone())
            .write_to(&mut Cursor::new(&mut bytes), ImageFormat::Png)
            .unwrap();
        bytes
    }

    #[test]
    fn bake_crops_solid_color_region() {
        // 4x2: left half red, right half blue (opaque RGB → JPEG bake)
        let mut img = RgbImage::new(4, 2);
        for y in 0..2 {
            for x in 0..4 {
                let color = if x < 2 {
                    Rgb([255, 0, 0])
                } else {
                    Rgb([0, 0, 255])
                };
                img.put_pixel(x, y, color);
            }
        }
        let bytes = encode_png_rgb(&img);

        let crop = ImageCrop {
            x: 0.5,
            y: 0.0,
            width: 0.5,
            height: 1.0,
        };
        let (out, ext) = bake_cropped_image(&bytes, crop, 2000).unwrap();
        assert_eq!(ext, "jpg");

        let decoded = image::load_from_memory(&out).unwrap().to_rgb8();
        assert_eq!(decoded.width(), 2);
        assert_eq!(decoded.height(), 2);
        let px = decoded.get_pixel(0, 0);
        assert!(px[2] > 200 && px[0] < 50, "expected blue pixel, got {px:?}");
    }

    #[test]
    fn bake_downscales_long_edge() {
        let img = RgbImage::from_pixel(4000, 2000, Rgb([10, 20, 30]));
        let bytes = encode_png_rgb(&img);
        let (out, _) = bake_cropped_image(&bytes, ImageCrop::full_frame(), 2000).unwrap();
        let decoded = image::load_from_memory(&out).unwrap();
        let (w, h) = decoded.dimensions();
        assert!(w <= 2000 && h <= 2000);
        assert_eq!(w.max(h), 2000);
    }

    #[test]
    fn bake_preserves_png_alpha() {
        let img = RgbaImage::from_pixel(8, 8, Rgba([10, 20, 30, 128]));
        let bytes = encode_png_rgba(&img);
        let (out, ext) = bake_cropped_image(&bytes, ImageCrop::full_frame(), 2000).unwrap();
        assert_eq!(ext, "png");
        let decoded = image::load_from_memory(&out).unwrap().to_rgba8();
        assert_eq!(decoded.get_pixel(0, 0)[3], 128);
    }

    #[test]
    fn clamp_max_edge_defaults_and_bounds() {
        assert_eq!(clamp_max_edge(None), MAX_DISPLAY_EDGE);
        assert_eq!(clamp_max_edge(Some(1000)), 1000);
        assert_eq!(clamp_max_edge(Some(0)), MIN_MAX_EDGE);
        assert_eq!(clamp_max_edge(Some(99_999)), MAX_DISPLAY_EDGE);
    }

    #[test]
    fn measure_matches_bake_and_shrinks_with_smaller_edges() {
        let img = RgbImage::from_fn(600, 600, |x, y| {
            Rgb([(x % 251) as u8, (y % 241) as u8, ((x * y) % 239) as u8])
        });
        let bytes = encode_png_rgb(&img);
        let crop = ImageCrop {
            x: 0.0,
            y: 0.0,
            width: 0.9,
            height: 0.9,
        };
        let sizes = measure_baked_sizes(&bytes, crop, &[None, Some(300), Some(100)]).unwrap();
        let (baked, _) = bake_cropped_image(&bytes, crop, MAX_DISPLAY_EDGE).unwrap();
        assert_eq!(sizes[0], baked.len() as u64);
        assert!(sizes[0] > sizes[1] && sizes[1] > sizes[2]);
    }

    #[test]
    fn passthrough_only_when_nothing_would_change() {
        let img = RgbImage::from_pixel(300, 300, Rgb([10, 20, 30]));
        let bytes = encode_png_rgb(&img);
        let full = ImageCrop::full_frame();
        assert!(is_passthrough(&bytes, full, 2000).unwrap());
        // Needs scaling down.
        assert!(!is_passthrough(&bytes, full, 200).unwrap());
        // A real crop.
        let half = ImageCrop {
            x: 0.0,
            y: 0.0,
            width: 0.5,
            height: 1.0,
        };
        assert!(!is_passthrough(&bytes, half, 2000).unwrap());
        // A wide image gets a centered square crop by default, which is an edit.
        let wide = encode_png_rgb(&RgbImage::from_pixel(400, 200, Rgb([1, 2, 3])));
        let square = ImageCrop {
            x: 0.25,
            y: 0.0,
            width: 0.5,
            height: 1.0,
        };
        assert!(!is_passthrough(&wide, square, 2000).unwrap());
    }

    #[test]
    fn measure_reports_source_size_for_passthrough() {
        let bytes = encode_png_rgb(&RgbImage::from_pixel(300, 300, Rgb([10, 20, 30])));
        let sizes =
            measure_baked_sizes(&bytes, ImageCrop::full_frame(), &[None, Some(100)]).unwrap();
        assert_eq!(sizes[0], bytes.len() as u64);
        assert_ne!(sizes[1], bytes.len() as u64);
    }

    #[test]
    fn squared_for_library_crops_wide_images_to_the_center() {
        let mut img = RgbImage::from_pixel(400, 200, Rgb([255, 0, 0]));
        for y in 0..200 {
            for x in 100..300 {
                img.put_pixel(x, y, Rgb([0, 0, 255]));
            }
        }
        let (out, ext) = squared_for_library(&encode_png_rgb(&img)).unwrap();
        assert_eq!(ext, "jpg");
        let decoded = image::load_from_memory(&out).unwrap().to_rgb8();
        assert_eq!((decoded.width(), decoded.height()), (200, 200));
        let px = decoded.get_pixel(0, 0);
        assert!(
            px[2] > 200 && px[0] < 60,
            "expected the blue center, got {px:?}"
        );
    }

    #[test]
    fn squared_for_library_leaves_squares_and_unknown_data_alone() {
        let square = encode_png_rgb(&RgbImage::from_pixel(64, 64, Rgb([1, 2, 3])));
        assert!(squared_for_library(&square).is_none());
        assert!(squared_for_library(b"not an image").is_none());
    }
}
