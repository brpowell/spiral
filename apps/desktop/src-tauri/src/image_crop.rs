//! Crop + bake helpers for cover art (playlist, album, artist).

use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use image::{DynamicImage, GenericImageView, ImageDecoder, ImageEncoder, ImageFormat, ImageReader};
use serde::{Deserialize, Serialize};
use std::io::Cursor;

pub const MAX_DISPLAY_EDGE: u32 = 2000;
pub const JPEG_QUALITY: u8 = 90;

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

/// Decode bytes, apply EXIF orientation, crop, optionally downscale, and encode.
///
/// Returns `(encoded_bytes, extension)` where extension is `"jpg"` or `"png"`.
pub fn bake_cropped_image(
    source_bytes: &[u8],
    crop: ImageCrop,
    max_edge: u32,
) -> Result<(Vec<u8>, &'static str), String> {
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
    let resized = if max_edge > 0 && (w > max_edge || h > max_edge) {
        cropped.resize(max_edge, max_edge, FilterType::Lanczos3)
    } else {
        cropped
    };

    let has_alpha = image_has_transparency(&resized);
    if has_alpha {
        let mut out = Vec::new();
        resized
            .write_to(&mut Cursor::new(&mut out), ImageFormat::Png)
            .map_err(|e| format!("failed to encode PNG: {e}"))?;
        Ok((out, "png"))
    } else {
        let rgb = resized.to_rgb8();
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
}
